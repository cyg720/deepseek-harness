/**
 * 文件职责：验证 llm/token-meter 中 route pricing spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  LlmRuntime, LlmAdapter, createMessage, createUserMessage, projectFilesToText,
} from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmImageRequestPricing, Message, StreamChunk, TokenUsage, UserMessage } from '@deepseek-ai/dsh-llm'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { FileAttachmentRef, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { Session, SessionId, canonicalHeader } from '@deepseek-ai/dsh-session'
import type { EpochHeader } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import { estimateContent, estimateMessage } from '../src/estimate.ts'

/** Adapter double declaring fixed per-occurrence image prices for one route.
 * @remarks 中文说明：类说明：PricingAdapter 用于集中封装 处理 PricingAdapter 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 llm/token-meter
 * 在对应插件或业务生命周期内创建和调用。 */
class PricingAdapter extends LlmAdapter {
  /**
   * 功能说明：处理 PricingAdapter 相关流程；使用场景由所在模块及调用位置决定。
   * @param pricing （(model: string) => LlmImageRequestPricing |
   * undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new PricingAdapter(pricing) 创建实例，并在所属生命周期内使用。
   */
  constructor(private readonly pricing: (model: string) => LlmImageRequestPricing | undefined) {
    super()
  }

  /**
   * 功能说明：处理 imageRequestPricing 相关流程；使用场景由所在模块及调用位置决定。
   * @param _provider （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param model （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns LlmImageRequestPricing | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 imageRequestPricing(_provider, model)，并按返回类型处理结果。
   */
  override imageRequestPricing(_provider: string, model: string): LlmImageRequestPricing | undefined {
    return this.pricing(model)
  }

  /**
   * 功能说明：处理 stream 相关流程；使用场景由所在模块及调用位置决定。
   * @param _options （GenerateOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
   * @returns AsyncIterable<StreamChunk>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 stream(_options)，并按返回类型处理结果。
   */
  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    throw new Error('the pricing adapter double does not stream')
  }
}

/**
 * 常量说明：VISUAL_TOKENS 用于处理 VISUAL_TOKENS 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const VISUAL_TOKENS = 100
/**
 * 常量说明：HANDLE_TEXT 用于处理 TEXT 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const HANDLE_TEXT = 'Image handle text'

/**
 * 常量说明：fixedPricing 用于处理 fixedPricing 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：images（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(images)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
const fixedPricing: LlmImageRequestPricing = {
  priceImages: images => images.map(() => ({ visualTokens: VISUAL_TOKENS, text: HANDLE_TEXT })),
}

/**
 * 功能说明：处理 imageRef 相关流程；使用场景由所在模块及调用位置决定。
 * @param name （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns ImageAttachmentRef；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 imageRef(name)，并按返回类型处理结果。
 */
function imageRef(name: string): ImageAttachmentRef {
  return {
    attachmentId: AttachmentId(`sha256:${name.padEnd(8, '0')}`),
    mediaType: 'image/png',
    bytes: 2048,
    width: 800,
    height: 800,
    name,
  }
}

/**
 * 功能说明：处理 imageMessage 相关流程；使用场景由所在模块及调用位置决定。
 * @param name （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param text （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns UserMessage；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 imageMessage(name, text)，并按返回类型处理结果。
 */
function imageMessage(name: string, text = 'look at this'): UserMessage {
  return createUserMessage({
    content: [
      { type: 'text', text },
      { type: 'image', attachment: imageRef(name) },
    ],
    source: { kind: 'user' },
  })
}

function fileRef(name: string): FileAttachmentRef {
  return {
    attachmentId: AttachmentId(`sha256:${'ab'.repeat(32)}`),
    name,
    bytes: 2_447_000_000,
  }
}

function header(model: string): EpochHeader {
  return canonicalHeader({ config: { provider: 'mock', model } })
}

interface Harness {
  meter: TokenMeter
  session: Session
}

/**
 * 功能说明：处理 harness 相关流程；使用场景由所在模块及调用位置决定。
 * @param pricing （(model: string) => LlmImageRequestPricing |
 * undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Promise<Harness>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 harness(pricing)，并按返回类型处理结果。
 */
async function harness(pricing: (model: string) => LlmImageRequestPricing | undefined): Promise<Harness> {
  /**
   * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const ctx = new Context()
  new SessionProjectionRegistry(ctx)
  ctx.provide('attachments', {
    fileHostPath: (ref: FileAttachmentRef) => `/host/${ref.name}`,
  } as never)
  ctx.provide('fs', {
    processPathFromHostPath: (path: string) => path.replace('/host/', '/sandbox/'),
  } as never)
  const llm = new LlmRuntime(ctx)
  llm.registerAdapter(['mock'], new PricingAdapter(pricing))
  /**
   * 常量说明：meter 用于处理 meter 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const meter = new TokenMeter(ctx)
  return { meter, session: Session.create(SessionId('route-priced')) }
}

/** Route price of one image-bearing message under the fixed pricing double.
 * @remarks 中文说明：功能说明：处理 routedMessageTokens 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：message（Message）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：number；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * routedMessageTokens(message)，并按返回类型处理结果。 */
function routedMessageTokens(message: Message): number {
  /**
   * 常量说明：imageFree 用于处理 imageFree 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：block（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(block)，并按返回类型处理结果。
   */
  const imageFree = estimateMessage({
    ...message,
    content: message.content.filter(block => block.type !== 'image'),
  })
  return imageFree + VISUAL_TOKENS + estimateContent([{ type: 'text', text: HANDLE_TEXT }])
}

/**
 * 功能说明：处理 appendSuccessfulCall 相关流程；使用场景由所在模块及调用位置决定。
 * @param session （Session）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param value （EpochHeader）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param usage （TokenUsage）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 appendSuccessfulCall(session, value, usage)，
 * 并按返回类型处理结果。
 */
function appendSuccessfulCall(session: Session, value: EpochHeader, usage?: TokenUsage): void {
  session.append('step/start', { turn: 1, step: 1 })
  session.append('request/header', { header: value, reason: 'initial' })
  session.append('assistant/message', {
    stream: [],
    turn: 1,
    step: 1,
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'answer' }],
      source: { kind: 'model', provider: value.config.provider, model: value.config.model },
    }),
    ...usage === undefined ? {} : { usage },
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 1 })
}

describe('request projection pricing', () => {
  it('prices file blocks as the exact handle text dispatched to the provider', async () => {
    const { meter, session } = await harness(() => undefined)
    const ref = fileRef('archive.zip')
    const message = createUserMessage({
      content: [{ type: 'file', attachment: ref }],
      source: { kind: 'user' },
    })
    session.append('user/message', message, { surfaceOp: 'append' })

    const measurement = meter.measure(session)
    const projected = projectFilesToText([message], file => `/sandbox/${file.name}`)[0]
    if (projected === undefined) throw new Error('missing projected file message')
    expect(measurement.nodes[0]?.tokens).toBe(estimateMessage(projected))
    expect(measurement.nodes[0]?.tokens).toBeGreaterThan(estimateMessage(message))
  })

  it('prices a first multimodal request estimate with the routed visual tokens', async () => {
    /**
     * 常量说明：meter、session 用于处理 meter、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const { meter, session } = await harness(() => fixedPricing)
    /**
     * 常量说明：message 用于处理 message 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const message = imageMessage('photo')
    session.append('user/message', message, { surfaceOp: 'append' })
    session.append('request/header', { header: header('vision'), reason: 'initial' })

    /**
     * 常量说明：measurement 用于处理 measurement 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const measurement = meter.measure(session)
    /**
     * 常量说明：expectedNode 用于处理 expectedNode 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const expectedNode = routedMessageTokens(message)
    expect(measurement.nodes).toHaveLength(1)
    /**
     * 常量说明：node 用于处理 node 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const node = measurement.nodes[0]!
    expect(node.tokens).toBe(expectedNode)
    expect(node.heuristicTokens).toBe(estimateMessage(message))
    expect(node.tokens).toBeGreaterThan(node.heuristicTokens)
    expect(measurement.baseline.kind).toBe('estimated')
    expect(measurement.surfaceTokens).toBe(expectedNode)
    expect(measurement.totalTokens).toBe(expectedNode)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('adds a post-anchor image at its routed price on top of provider usage', async () => {
    /**
     * 常量说明：meter、session 用于处理 meter、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const { meter, session } = await harness(() => fixedPricing)
    /**
     * 常量说明：usage 用于处理 usage 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const usage: TokenUsage = { inputTokens: 5000, outputTokens: 50 }
    appendSuccessfulCall(session, header('vision'), usage)
    /**
     * 常量说明：before 用于处理 before 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const before = meter.measure(session)
    expect(before.baseline).toMatchObject({ kind: 'usage', tokens: 5050 })

    /**
     * 常量说明：message 用于处理 message 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const message = imageMessage('fresh')
    session.append('user/message', message, { surfaceOp: 'append' })
    /**
     * 常量说明：after 用于处理 after 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const after = meter.measure(session)
    expect(after.baseline).toMatchObject({ kind: 'usage', tokens: 5050 })
    expect(after.surfaceDeltaTokens - before.surfaceDeltaTokens).toBe(routedMessageTokens(message))
    expect(after.totalTokens).toBe(5050 + after.surfaceDeltaTokens)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('reprices the surface under the substitution pricing of a text-only route', async () => {
    /**
     * 常量说明：placeholder 用于处理 placeholder 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const placeholder = '[image omitted for the text-only route]'
    /**
     * 常量说明：substitution 用于处理 substitution 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：images（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(images)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const substitution: LlmImageRequestPricing = {
      priceImages: images => images.map(() => ({ visualTokens: 0, text: placeholder })),
    }
    /**
     * 常量说明：meter、session 用于处理 meter、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：model（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(model)，并按返回类型处理结果。
     */
    const { meter, session } = await harness(model => (model === 'vision' ? fixedPricing : substitution))
    /**
     * 常量说明：message 用于处理 message 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const message = imageMessage('photo')
    session.append('user/message', message, { surfaceOp: 'append' })
    session.append('request/header', { header: header('vision'), reason: 'initial' })

    /**
     * 常量说明：textOnly 用于处理 textOnly 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const textOnly = meter.measure(session, header('text-only'))
    /**
     * 常量说明：imageFree 用于处理 imageFree 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：block（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(block)，并按返回类型处理结果。
     */
    const imageFree = estimateMessage({
      ...message,
      content: message.content.filter(block => block.type !== 'image'),
    })
    expect(textOnly.nodes[0]!.tokens)
      .toBe(imageFree + estimateContent([{ type: 'text', text: placeholder }]))
    expect(textOnly.totalTokens).toBeLessThan(meter.measure(session).totalTokens)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('keeps the fixed heuristic for routes and services that declare no pricing', async () => {
    /**
     * 常量说明：meter、session 用于处理 meter、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const { meter, session } = await harness(() => undefined)
    /**
     * 常量说明：message 用于处理 message 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const message = imageMessage('photo')
    session.append('user/message', message, { surfaceOp: 'append' })
    session.append('request/header', { header: header('vision'), reason: 'initial' })
    /**
     * 常量说明：declared 用于处理 declared 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const declared = meter.measure(session)
    expect(declared.nodes[0]!.tokens).toBe(estimateMessage(message))

    /**
     * 常量说明：unknownRoute 用于处理 unknownRoute 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const unknownRoute = meter.measure(
      session,
      canonicalHeader({ config: { provider: 'unregistered', model: 'any' } }),
    )
    expect(unknownRoute.nodes[0]!.tokens).toBe(estimateMessage(message))
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('fails loud when a route answers a mismatched occurrence count', async () => {
    /**
     * 常量说明：broken 用于处理 broken 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const broken: LlmImageRequestPricing = { priceImages: () => [] }
    /**
     * 常量说明：meter、session 用于处理 meter、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const { meter, session } = await harness(() => broken)
    session.append('user/message', imageMessage('photo'), { surfaceOp: 'append' })
    session.append('request/header', { header: header('vision'), reason: 'initial' })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => meter.measure(session))
      .toThrow('route image pricing answered 0 prices for 1 occurrences')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('prices nested tool-result images through the same route pricing', async () => {
    /**
     * 常量说明：meter、session 用于处理 meter、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const { meter, session } = await harness(() => fixedPricing)
    /**
     * 常量说明：nested 用于处理 nested 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const nested = createUserMessage({
      content: [{
        type: 'tool-result',
        toolCallId: 'call-1' as never,
        content: [
          { type: 'text', text: 'screenshot below' },
          { type: 'image', attachment: imageRef('nested') },
        ],
      }],
      source: { kind: 'user' },
    })
    session.append('user/message', nested, { surfaceOp: 'append' })
    session.append('request/header', { header: header('vision'), reason: 'initial' })
    /**
     * 常量说明：measurement 用于处理 measurement 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const measurement = meter.measure(session)
    /**
     * 常量说明：imageFree 用于处理 imageFree 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const imageFree = estimateMessage({
      ...nested,
      content: [{
        ...nested.content[0] as Extract<Message['content'][number], { type: 'tool-result' }>,
        content: [{ type: 'text', text: 'screenshot below' }],
      }],
    })
    expect(measurement.nodes[0]!.tokens)
      .toBe(imageFree + VISUAL_TOKENS + estimateContent([{ type: 'text', text: HANDLE_TEXT }]))
  })
})
