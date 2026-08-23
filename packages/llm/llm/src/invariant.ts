/**
 * ================================ 文件注释 ================================
 * 【文件职责】以 Cordis 伴生插件（companion plugin）形式定义 dsh-llm 的流
 * 协议不变量：校验每个 provider 流的分块语法是否符合约定（块索引配对、用量
 * 只出现一次、必须以终结 finish 结束等），以及注册表通知时刻的可读性。
 * 【技术维度】基于 @deepseek-ai/dsh-invariants 的 InvariantInstaller 机制：
 * 通过 ctx.on 在 llm/stream 流上包一层校验生成器（prepend + global），在
 * 消费每个 chunk 的同时做语法校验；不变量违规通过 fail 回调上报。
 * 【产品维度】流协议是适配器与上层（agent loop、会话日志）的契约，违规会
 * 导致状态错乱；本插件在开发期与运行期尽早暴露契约破坏，属于工程质量保障。
 * 【逻辑维度】包名常量与插件元信息（name/inject）→ 三个校验辅助（索引、delta
 * 配对、整流校验生成器）→ 安装函数 install 挂接两个事件 → apply 注册。
 * 【关键边界】校验只读不改：yield 原 chunk 透传；finish 时若还有未关闭块
 * （error/aborted 除外）即违规；整流结束必须出现终结 finish。
 * 【新手阅读建议】先读 validateStream 的 switch，理解流协议每个 chunk 的
 * 合法形态；再看 install 理解"何时何地挂接校验"。
 * ==========================================================================
 */

/** Package-owned LLM stream-protocol invariants. @module @deepseek-ai/dsh-llm/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { ContentBlockType, StreamChunk } from './types.ts'

/** 中文：本伴生插件注册不变量时使用的包名标识。 */
const PACKAGE_NAME = '@deepseek-ai/dsh-llm'

/** Cordis companion plugin name. */
// 中文：Cordis 伴生插件名，供协作者按名注入/引用。
export const name = 'llm-invariant'
/** Service required before the companion can reserve package ownership. */
// 中文：该插件要求 invariants 服务先就绪，才能登记包级所有权。
export const inject = ['invariants']

/** Require one chunk index to be a non-negative safe integer. */
// 中文：要求块索引是非负的安全整数（安全整数即 JS 中可被精确表示的整数）。
function validateIndex(index: number, fail: InvariantFailure): void {
  if (!Number.isSafeInteger(index) || index < 0) {
    fail(`LLM stream block index must be a non-negative safe integer, got ${index}`)
  }
}

/** Require a delta to address an open block of its matching type. */
// 中文：要求某条 delta 指向一个"已打开且类型匹配"的块：索引必须合法、块必须
// 处于打开状态、且类型与 delta 期望的类型一致。
function validateDelta(
  open: ReadonlyMap<number, ContentBlockType>,
  index: number,
  expected: ContentBlockType,
  fail: InvariantFailure,
): void {
  validateIndex(index, fail)
  const actual = open.get(index)
  if (actual !== expected) {
    fail(`${expected} delta at index ${index} requires an open ${expected} block, got ${String(actual)}`)
  }
}

/** Wrap one provider stream and enforce its grammar as chunks are consumed. */
// 中文：包一层 provider 流，在消费每个 chunk 时强制执行流语法：
// 维护 open（当前打开的块索引→类型）、usageSeen（用量是否已见）、finished
// （是否已收到终结 finish），任何违规都通过 fail 上报。
async function* validateStream(
  source: AsyncIterable<StreamChunk>,
  fail: InvariantFailure,
): AsyncIterable<StreamChunk> {
  const open = new Map<number, ContentBlockType>()
  let usageSeen = false
  let finished = false
  for await (const chunk of source) {
    if (finished) fail(`LLM stream emitted ${chunk.type} after terminal finish`)
    switch (chunk.type) {
      case 'block-start':
        validateIndex(chunk.index, fail)
        if (open.has(chunk.index)) fail(`LLM stream repeated block-start index ${chunk.index}`)
        open.set(chunk.index, chunk.blockType)
        break
      case 'text-delta':
        validateDelta(open, chunk.index, 'text', fail)
        break
      case 'reasoning-delta':
        validateDelta(open, chunk.index, 'reasoning', fail)
        break
      case 'tool-call-delta':
        validateDelta(open, chunk.index, 'tool-call', fail)
        break
      case 'block-end': {
        validateIndex(chunk.index, fail)
        const blockType = open.get(chunk.index)
        if (blockType === undefined) fail(`LLM stream block-end index ${chunk.index} has no open block`)
        if (chunk.block.type !== blockType) {
          fail(`LLM stream block-end index ${chunk.index} closes ${chunk.block.type}, expected ${blockType}`)
        }
        open.delete(chunk.index)
        break
      }
      case 'usage':
        if (usageSeen) fail('LLM stream emitted usage more than once')
        usageSeen = true
        break
      case 'finish':
        if (open.size > 0 && chunk.reason.kind !== 'error' && chunk.reason.kind !== 'aborted') {
          fail(`LLM stream finished with ${open.size} open block(s)`)
        }
        finished = true
        break
    }
    yield chunk
  }
  if (!finished) fail('LLM stream ended without a terminal finish chunk')
}

/** Install validation around every provider stream. */
// 中文：安装校验：在 llm/stream 瀑布流的最前面（prepend + global）包上
// validateStream；同时监听 llm/adapters-updated，在注册表变动后立刻检查每个
// provider 的重试策略是否可读（可读即"通知承诺"成立）。
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('llm/stream', (_options, next) => validateStream(next(), fail), { global: true, prepend: true })
  ctx.on('llm/adapters-updated', () => {
    // A disposer-time emit can outlive the service-store entry during whole-
    // context teardown; only a live service promises a readable registry.
    // 中文：disposer 时刻的 emit 可能发生在整体 teardown 中，晚于服务存储项
    // 的销毁；只有存活的服务才承诺注册表可读，所以先取服务再判断。
    const llm = ctx.get('llm')
    if (llm === undefined) return
    for (const provider of llm.listProviders()) {
      try {
        llm.providerRetryPolicy(provider.id)
      } catch {
        // Reaching here IS the violation: the notification promised a readable
        // registry, and only that broken promise can make the lookup throw.
        // 中文：能走到这里本身就是违规：通知承诺了注册表可读，只有这个承诺被
        // 打破，上面的查找才会抛出异常。
        fail(`llm/adapters-updated fired while provider "${provider.id}" has no readable registration`)
      }
    }
  }, { global: true })
}

/**
 * （中文）注册 LLM 不变量伴生插件：把本包的校验安装函数交给 invariants 服务
 * 登记。插件系统在 setup 成功后返回 disposer 以撤销登记。
 * @param ctx 携带 invariants 服务的 Cordis 上下文。
 * @returns 安装成功后返回可撤销登记的 disposer。
 */
/**
 * Register the LLM invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
