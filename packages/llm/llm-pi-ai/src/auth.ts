/**
 * The three adapters between pi-ai's auth model and the harness credential
 * plane. Every pi-ai-specific concept stays on this side of them: the harness
 * seams they consume — `ctx.credentials` records and `ctx.authorization` flows —
 * name nothing from this library, so another adapter family can arrive with a
 * different auth model and share the same two seams.
 *
 * @module dsh-llm-pi-ai/auth
 */
/**
 * 文件职责：实现Pi AI LLM的 auth.ts 模块。
 * 技术维度：TypeScript、Fetch、SSE、OAuth/密钥认证、模型目录和运行时模式校验。
 * 产品维度：让 Agent 能稳定调用供应商模型、发现能力并接收流式结果。
 * 逻辑维度：解析配置和认证，转换请求，消费流并映射模型事件。
 * 关键边界：网络响应属于不可信输入；密钥和令牌不得记录；取消必须终止请求与流。
 * 新手阅读建议：先读 config/auth/catalog，再看 adapter/stream，最后阅读错误和重放测试。
 */

import { homedir } from 'node:os'
import { access } from 'node:fs/promises'
import { resolve as resolvePath } from 'node:path'
import type { AuthContext, Credential, CredentialInfo, CredentialStore } from '@earendil-works/pi-ai'
import type { Context } from '@deepseek-ai/cordis'
import {
  credentialKey, credentialKeyId, credentialKeyScope, credentialRef, isCredentialKeySegment, isCredentialRefName,
} from '@deepseek-ai/dsh-credentials'
import type { CredentialKey, CredentialProvider, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { LlmError } from '@deepseek-ai/dsh-llm'

/**
 * The record scope every credential this adapter family stores is written
 * under. It is the plugin's registered name, which is what tells a later
 * reader — a configuration UI, or a second adapter family serving the same
 * provider name — that this plugin owns the format inside the record.
 */
/** 中文说明：适配器局部值 RECORD_SCOPE，由紧邻初始化决定。 */
export const RECORD_SCOPE = 'llm-pi-ai'

/**
 * The record address for one pi-ai provider id.
 * @param providerId - pi-ai's own provider id, which is also the harness route key.
 * @returns the scoped credential key this adapter family reads and writes.
 */
/** 中文说明：函数 recordKeyFor 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
export function recordKeyFor(providerId: string): CredentialKey {
  return credentialKey(RECORD_SCOPE, providerId)
}

/**
 * Translate a stored record into the credential pi-ai expects.
 *
 * An `api-key` record is structural on both sides, so it is rebuilt field by
 * field. A `grant` payload is pi-ai's own OAuth credential, stored verbatim:
 * the seam treats it as opaque JSON precisely so a library that owns a token
 * format keeps owning it, refresh fields and all.
 * @param record - the stored record, or undefined when nothing is stored.
 * @returns the pi-ai credential, or undefined for an absent record.
 */
/** 中文说明：函数 toPiCredential 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
function toPiCredential(record: CredentialRecord | undefined): Credential | undefined {
  if (record === undefined) return undefined
  if (record.kind === 'api-key') {
    return {
      type: 'api_key',
      ...record.key === undefined ? {} : { key: record.key },
      ...record.env === undefined ? {} : { env: { ...record.env } },
    }
  }
  return record.payload as Credential
}

/**
 * Translate a pi-ai credential into the record to store.
 * @param credential - what a login or refresh produced.
 * @returns the record to commit, in the union the credential seam stores.
 */
/** 中文说明：函数 toRecord 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
function toRecord(credential: Credential): CredentialRecord {
  if (credential.type === 'api_key') {
    return {
      kind: 'api-key',
      ...credential.key === undefined ? {} : { key: credential.key },
      ...credential.env === undefined ? {} : { env: { ...credential.env } },
    }
  }
  return { kind: 'grant', payload: credential }
}

/**
 * The credential service, or the failure that names what is missing. Reads
 * answer "nothing stored" without a service, because a composition with no
 * credential plane genuinely holds no credential; writes refuse, because a
 * login whose grant silently evaporated would report success and then fail
 * every request.
 * @param ctx - the plugin context.
 * @returns the live service.
 * @throws {LlmError} code `NO_CREDENTIAL_STORE` when none is mounted.
 */
/** 中文说明：函数 writableStore 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
function writableStore(ctx: Context): CredentialProvider {
  /** 中文说明：适配器局部值 credentials，由紧邻初始化决定。 */
  const credentials = ctx.get('credentials')
  if (credentials === undefined) {
    throw new LlmError(
      'llm-pi-ai: this composition mounts no credentials service, so there is nowhere to store the'
      + ' credential a sign-in produces; mount one (dsh-credentials-local) to sign in',
      'NO_CREDENTIAL_STORE',
    )
  }
  return credentials
}

/**
 * A pi-ai `CredentialStore` over the harness credential records.
 *
 * pi-ai runs OAuth refresh *inside* `modify()`, so this store's exclusion has
 * to cover a network round trip rather than a file rename — which is why the
 * record write path takes a wait limit of its own rather than the short one a
 * local write would need.
 *
 * pi-ai asks this store about every provider in the collection, hand-declared
 * routes included, and a route key is an arbitrary settings dict key while a
 * record id is not. An id outside the record grammar can never have stored a
 * record, so reads answer "nothing stored" and a delete has nothing to remove;
 * only `modify` refuses it, because a write that cannot land must not report
 * that it did.
 * @param ctx - the plugin context carrying the optional `ctx.credentials`.
 * @returns the store to hand `createModels()`.
 */
/** 中文说明：函数 credentialStoreFrom 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
export function credentialStoreFrom(ctx: Context): CredentialStore {
  return {
    async read(providerId) {
      /** 中文说明：适配器局部值 credentials，由紧邻初始化决定。 */
      const credentials = ctx.get('credentials')
      if (credentials === undefined) return undefined
      if (!isCredentialKeySegment(providerId)) return undefined
      return toPiCredential(await credentials.readRecord(recordKeyFor(providerId)))
    },
    async list(): Promise<readonly CredentialInfo[]> {
      /** 中文说明：适配器局部值 stored，由紧邻初始化决定。 */
      const stored = await ctx.get('credentials')?.listRecords() ?? []
      /** 中文说明：适配器局部值 mine，由紧邻初始化决定。 */
      const mine: CredentialInfo[] = []
      /** 中文说明：适配器局部值 entry，由紧邻初始化决定。 */
      for (const entry of stored) {
        // Records another plugin owns are not this collection's to report:
        // their payloads are written in a format pi-ai never agreed to.
        if (credentialKeyScope(entry.key) !== RECORD_SCOPE) continue
        mine.push({
          providerId: credentialKeyId(entry.key),
          type: entry.kind === 'api-key' ? 'api_key' : 'oauth',
        })
      }
      return mine
    },
    async modify(providerId, mutate) {
      if (!isCredentialKeySegment(providerId)) {
        throw new LlmError(
          `llm-pi-ai: provider id "${providerId}" cannot address a stored credential record (a record id is a`
          + ' lowercase hyphenated identifier); authenticate this route through apiKeyEnv instead of a stored'
          + ' credential',
          'UNSTORABLE_PROVIDER_ID',
        )
      }
      /** 中文说明：适配器局部值 stored，由紧邻初始化决定。 */
      const stored = await writableStore(ctx).modifyRecord(recordKeyFor(providerId), async (current) => {
        /** 中文说明：适配器局部值 next，由紧邻初始化决定。 */
        const next = await mutate(toPiCredential(current))
        return next === undefined ? undefined : toRecord(next)
      })
      return toPiCredential(stored)
    },
    // `async` so a missing service reaches the caller as a rejection: pi-ai's
    // store contract is promise-returning, and a synchronous throw would
    // escape the `ModelsError` wrapper every other storage failure gets.
    async delete(providerId) {
      if (!isCredentialKeySegment(providerId)) return
      await writableStore(ctx).deleteRecord(recordKeyFor(providerId))
    },
  }
}

/**
 * A pi-ai `AuthContext` over the harness credential plane and the host
 * filesystem.
 *
 * `env()` answers from the credential seam first, so a value a deployment
 * stored through the harness is found by a provider's own ambient discovery —
 * without this, that discovery reads only the process environment and a stored
 * `AWS_ACCESS_KEY_ID` is invisible to it. `fileExists()` answers about the host
 * process's own filesystem rather than the workspace `ctx.fs` seam, because the
 * paths it is asked about (`~/.aws/credentials`, application-default
 * credentials) are facts about where this process runs, not about the project
 * under edit.
 * @param ctx - the plugin context carrying the optional `ctx.credentials`.
 * @returns the auth context to hand `createModels()`.
 */
/** 中文说明：函数 authContextFrom 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
export function authContextFrom(ctx: Context): AuthContext {
  return {
    async env(name) {
      // pi-ai asks about arbitrary provider-declared names; one that is not a
      // POSIX identifier can never have been stored as a reference, and asking
      // the seam would throw instead of answering "not set".
      if (isCredentialRefName(name)) {
        /** 中文说明：适配器局部值 credentials，由紧邻初始化决定。 */
        const credentials = ctx.get('credentials')
        /** 中文说明：适配器局部值 hit，由紧邻初始化决定。 */
        const hit = await credentials?.resolve(credentialRef(name))
        if (hit !== undefined) return hit.value
      }
      return launchEnvironmentOf(ctx).get(name)?.value
    },
    async fileExists(path) {
      /** 中文说明：适配器局部值 expanded，由紧邻初始化决定。 */
      const expanded = path.startsWith('~/') || path === '~'
        ? resolvePath(homedir(), path.slice(1).replace(/^\//, ''))
        : path
      try {
        await access(expanded)
        return true
      } catch {
        // Absent, unreadable, or a broken symlink — every one of which means
        // this ambient credential source cannot be used, which is the only
        // distinction the caller makes.
        return false
      }
    },
  }
}
