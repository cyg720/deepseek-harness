/**
 * Answering "which models can this provider serve?" for the configuration
 * surface's "fetch available models" action.
 *
 * A route the installed pi-ai catalog ships is answered **from that catalog**,
 * with no network call at all: pi-ai's registry is the authoritative list for
 * its own providers, and it carries the capacities a listing endpoint would
 * not disclose. Only a route the catalog does not describe — a gateway, a
 * self-hosted server — is interrogated over the wire.
 *
 * Neither path is a catalog refresh. Nothing here is stored: the request
 * carries a draft the user is still editing, and the reply is candidate
 * metadata the surface offers for adoption. `settings.yaml` remains the only
 * thing that decides what a route serves.
 *
 * Only OpenAI-compatible protocols are interrogated. Their listing is the one
 * shape a gateway, a self-hosted server, and the official endpoints all agree
 * on, which is the case this action exists for; every other protocol reports
 * that it cannot be interrogated so the surface falls back to hand-entry
 * rather than guessing a response shape.
 *
 * @module dsh-llm-pi-ai/discovery
 */
/*
 * 文件职责：实现Pi AI LLM的 discovery.ts 模块。
 * 技术维度：TypeScript、Fetch、SSE、OAuth/密钥认证、模型目录和运行时模式校验。
 * 产品维度：让 Agent 能稳定调用供应商模型、发现能力并接收流式结果。
 * 逻辑维度：解析配置和认证，转换请求，消费流并映射模型事件。
 * 关键边界：网络响应属于不可信输入；密钥和令牌不得记录；取消必须终止请求与流。
 * 新手阅读建议：先读 config/auth/catalog，再看 adapter/stream，最后阅读错误和重放测试。
 */

import { INVALID_CREDENTIAL_CODE, LlmError, normalizeApiKey } from '@deepseek-ai/dsh-llm'
import type { LlmDiscoveredModel, LlmModelDiscoveryOperation } from '@deepseek-ai/dsh-llm'
import { attributionHeaders } from '@deepseek-ai/dsh-llm'
import { catalogModels } from './catalog.ts'

/**
 * Protocols whose model listing this module can read: the two that speak
 * OpenAI's `GET /models` shape with bearer auth. Azure is absent despite its
 * OpenAI lineage — it authenticates with an `api-key` header and requires an
 * `api-version` query — and Codex authenticates through OAuth; guessing at
 * either would report an authentication failure as a provider with no models.
 * pi-ai's remaining protocols are absent for the same reason.
 */
/* 中文说明：适配器局部值 LISTABLE_PROTOCOLS，由紧邻初始化决定。 */
const LISTABLE_PROTOCOLS: ReadonlySet<string> = new Set([
  'openai-completions',
  'openai-responses',
])

/**
 * Endpoint replies larger than this are refused. The endpoint is whatever URL
 * the user typed, so the ceiling holds on the bytes actually read rather than
 * on the length the server claims — the same two-stage shape `dsh-web-fetch`
 * uses for its own caller-supplied URLs, except that a truncated model listing
 * is not parseable, so overflow rejects instead of truncating.
 */
/* 中文说明：适配器局部值 MAX_RESPONSE_BYTES，由紧邻初始化决定。 */
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024

/** One entry of an OpenAI-compatible `GET /models` reply. */
/* 中文说明：类型或类 ListingEntry 约束模型请求、认证或流事件职责。 */
interface ListingEntry {
  id?: unknown
  /** Common gateway extensions; absent from the official listings. */
  name?: unknown
  display_name?: unknown
  context_window?: unknown
  context_length?: unknown
  max_tokens?: unknown
  max_output_tokens?: unknown
}

/** A positive integer field of a listing entry, or `undefined` when absent or unusable. */
/* 中文说明：函数 capacity 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
function capacity(...candidates: readonly unknown[]): number | undefined {
  /** 中文说明：适配器局部值 candidate，由紧邻初始化决定。 */
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isInteger(candidate) && candidate > 0) return candidate
  }
  return undefined
}

/** A non-empty string field of a listing entry, or `undefined`. */
/* 中文说明：函数 label 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
function label(...candidates: readonly unknown[]): string | undefined {
  /** 中文说明：适配器局部值 candidate，由紧邻初始化决定。 */
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate
  }
  return undefined
}

/**
 * Join the endpoint base with the listing path. The base is treated as a
 * prefix rather than a URL to resolve against, so a deployment path such as
 * `https://gateway.example/openai/v1` keeps its segments instead of losing
 * them to `URL` resolution.
 */
/* 中文说明：函数 listingUrl 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
function listingUrl(baseURL: string): string {
  return `${baseURL.replace(/\/+$/, '')}/models`
}

/**
 * Read a reply body, refusing one that outgrows the ceiling. A declared length
 * is checked first so an honest server is turned away without transferring
 * anything; the accumulated total is what actually enforces the bound, because
 * a server that under-declares (or streams) tells us nothing up front.
 */
/* 中文说明：函数 readBounded 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
async function readBounded(response: Response, url: string): Promise<string> {
  /** 中文说明：适配器局部值 oversized，由紧邻初始化决定。 */
  const oversized = (): LlmError =>
    new LlmError(`${url} answered with more than ${MAX_RESPONSE_BYTES} bytes`, 'DISCOVERY_FAILED')
  /** 中文说明：适配器局部值 declared，由紧邻初始化决定。 */
  const declared = Number(response.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel()
    throw oversized()
  }
  /* v8 ignore next -- fetch always exposes a body stream on a 2xx Response; the null guard is defensive. */
  if (response.body === null) return ''
  /** 中文说明：适配器局部值 reader，由紧邻初始化决定。 */
  const reader = response.body.getReader()
  /** 中文说明：适配器局部值 chunks，由紧邻初始化决定。 */
  const chunks: Uint8Array[] = []
  /** 中文说明：适配器局部值 total，由紧邻初始化决定。 */
  let total = 0
  try {
    for (;;) {
      /** 中文说明：适配器局部值 { done, value }，由紧邻初始化决定。 */
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) throw oversized()
      chunks.push(value)
    }
  } finally {
    /* v8 ignore next 4 -- cancel() after a completed or abandoned read settles without rejecting; unobserved best-effort cleanup. */
    await reader.cancel().catch(() => {
      // Cancel after a drained read, or after this function walked away from
      // an oversized one, is cleanup; the reply is already decided either way.
    })
  }
  /** 中文说明：适配器局部值 body，由紧邻初始化决定。 */
  const body = new Uint8Array(total)
  /** 中文说明：适配器局部值 offset，由紧邻初始化决定。 */
  let offset = 0
  /** 中文说明：适配器局部值 chunk，由紧邻初始化决定。 */
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

/**
 * Read one OpenAI-compatible listing reply. Entries without a usable id are
 * skipped rather than failing the whole interrogation: a single malformed row
 * should not deny the user the rest of a working endpoint's catalog.
 */
/* 中文说明：函数 readListing 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
function readListing(body: unknown): LlmDiscoveredModel[] {
  /** 中文说明：适配器局部值 data，由紧邻初始化决定。 */
  const data = (body as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) {
    throw new LlmError(
      'the endpoint\'s model listing has no "data" array; enter this provider\'s models by hand',
      'DISCOVERY_FAILED',
    )
  }
  /** 中文说明：适配器局部值 models，由紧邻初始化决定。 */
  const models: LlmDiscoveredModel[] = []
  /** 中文说明：适配器局部值 raw，由紧邻初始化决定。 */
  for (const raw of data) {
    /** 中文说明：适配器局部值 entry，由紧邻初始化决定。 */
    const entry = raw as ListingEntry | null
    /** 中文说明：适配器局部值 id，由紧邻初始化决定。 */
    const id = label(entry?.id)
    if (id === undefined) continue
    /** 中文说明：适配器局部值 name，由紧邻初始化决定。 */
    const name = label(entry?.name, entry?.display_name)
    /** 中文说明：适配器局部值 contextWindow，由紧邻初始化决定。 */
    const contextWindow = capacity(entry?.context_window, entry?.context_length)
    /** 中文说明：适配器局部值 maxTokens，由紧邻初始化决定。 */
    const maxTokens = capacity(entry?.max_output_tokens, entry?.max_tokens)
    models.push({
      id,
      ...name === undefined ? {} : { name },
      ...contextWindow === undefined ? {} : { contextWindow },
      ...maxTokens === undefined ? {} : { maxTokens },
    })
  }
  return models
}

/**
 * Accept one probe key, or refuse it before the header is built. Without this
 * the `fetch` below would throw a ByteString `TypeError` that this function's
 * catch reports as `could not reach <url>` — blaming the network for a local,
 * deterministic fault.
 * @param raw - the key typed into the form or read from storage.
 * @returns the trimmed, usable key.
 */
/* 中文说明：函数 usableProbeKey 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
function usableProbeKey(raw: string): string {
  /** 中文说明：适配器局部值 checked，由紧邻初始化决定。 */
  const checked = normalizeApiKey(raw)
  if (checked.ok) return checked.value
  throw new LlmError(
    checked.reason === 'empty'
      ? 'this provider\'s API key is blank; enter it on the Models page, or clear it to probe unauthenticated'
      : 'this provider\'s API key contains characters no HTTP header can carry; paste the raw key only',
    INVALID_CREDENTIAL_CODE,
  )
}

/**
 * Interrogate one draft provider endpoint for the models it advertises.
 * @param request - the endpoint, protocol, and one-shot credential to use.
 * @param storedApiKey - the credential the named route already stored, asked
 *   for only when the draft carries none and only on the path that reaches the
 *   network. A configuration surface never holds a stored secret — it edits a
 *   redacted descriptor — so without this an already-configured route would be
 *   interrogated unauthenticated and answer 401.
 * @returns the advertised models in endpoint order.
 * @throws LlmError when the protocol has no readable listing, the endpoint
 *   refuses or fails the request, or the reply is not a model listing.
 */
/*
 * 中文说明：函数 discoverModels 的参数见签名，返回结果供模型流程使用；示例见本文件。
 * @param request 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param storedApiKey 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export async function discoverModels(
  request: LlmModelDiscoveryOperation,
  storedApiKey?: () => Promise<string | undefined>,
): Promise<readonly LlmDiscoveredModel[]> {
  // A catalog route already has its answer, and a better one: the installed
  // entries carry context windows and output caps no listing endpoint reports.
  if (request.provider !== undefined) {
    /** 中文说明：适配器局部值 installed，由紧邻初始化决定。 */
    const installed = catalogModels(request.provider)
    if (installed.size > 0) {
      return [...installed.values()].map(model => ({
        id: model.id,
        name: model.name,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
      }))
    }
  }
  if (request.baseURL === undefined || request.baseURL.length === 0) {
    throw new LlmError(
      `pi-ai ships no catalog for provider "${request.provider ?? ''}", so its models can only come from its`
      + " endpoint; set a baseURL, or enter this provider's models by hand",
      'DISCOVERY_FAILED',
    )
  }
  // A draft that has not chosen a protocol yet is asked as OpenAI Chat
  // Completions: it is the shape a gateway is overwhelmingly likely to speak,
  // and the alternative — refusing until the field is filled — would withhold
  // the action from the case it exists for. The cost is a misdirected message
  // when the endpoint speaks something else (an Anthropic gateway answers 401,
  // which reads as a credential problem), and hand-entry remains the way out.
  /** 中文说明：适配器局部值 api，由紧邻初始化决定。 */
  const api = request.api ?? 'openai-completions'
  if (!LISTABLE_PROTOCOLS.has(api)) {
    throw new LlmError(
      `pi-ai protocol "${api}" has no model listing this build can read; enter this provider's models by hand`,
      'DISCOVERY_UNSUPPORTED',
    )
  }
  /** 中文说明：适配器局部值 url，由紧邻初始化决定。 */
  const url = listingUrl(request.baseURL)
  // A key typed into the form wins: it is the one the user is testing, and it
  // may be the replacement for exactly the stored key that is failing. The
  // stored one is only asked for here, past the catalog short-circuit and the
  // protocol check, so a route answered from the registry costs no credential
  // lookup — and no diagnostic about a credential it never needed.
  // A probe carrying no key stays unauthenticated, which is how a route that
  // relies on the provider's own ambient discovery is meant to be asked.
  /** 中文说明：适配器局部值 supplied，由紧邻初始化决定。 */
  const supplied = request.apiKey ?? await storedApiKey?.()
  /** 中文说明：适配器局部值 apiKey，由紧邻初始化决定。 */
  const apiKey = supplied === undefined ? undefined : usableProbeKey(supplied)
  /** 中文说明：适配器局部值 response: Response，由紧邻初始化决定。 */
  let response: Response
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        ...apiKey === undefined ? {} : { authorization: `Bearer ${apiKey}` },
        ...attributionHeaders(),
      },
      ...request.signal === undefined ? {} : { signal: request.signal },
    })
  } catch (error: unknown) {
    if (request.signal?.aborted) {
      throw new LlmError('model discovery aborted by caller', 'ABORTED', { cause: error })
    }
    throw new LlmError(`could not reach ${url}`, 'DISCOVERY_FAILED', { cause: error })
  }
  if (!response.ok) {
    throw new LlmError(
      `${url} answered ${response.status}${response.status === 401 || response.status === 403 ? '; check the API key' : ''}`,
      'DISCOVERY_FAILED',
    )
  }
  /** 中文说明：适配器局部值 text: string，由紧邻初始化决定。 */
  let text: string
  try {
    text = await readBounded(response, url)
  } catch (error: unknown) {
    // Cancellation during the body read rejects with the abort reason, which
    // may be any value; the caller gets the same coded failure it would have
    // for a cancellation before the request went out.
    if (request.signal?.aborted) {
      throw new LlmError('model discovery aborted by caller', 'ABORTED', { cause: error })
    }
    throw error
  }
  /** 中文说明：适配器局部值 body: unknown，由紧邻初始化决定。 */
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch (error: unknown) {
    throw new LlmError(`${url} did not answer with JSON`, 'DISCOVERY_FAILED', { cause: error })
  }
  return readListing(body)
}
