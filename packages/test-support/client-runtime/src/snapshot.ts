/**
 * DOM snapshot hygiene: a vitest snapshot serializer that keeps `.snap`
 * files structural. Two normalizations, both on a clone (the live DOM is
 * untouched, so class/tag queries keep working):
 *
 * - CSS-module scoped class names (`_frame_334d2d`, this repo's
 *   `_[local]_[hash]` shape) fold back to their semantic local (`frame`), so
 *   CSS edits do not churn snapshots.
 * - `<svg>` internals collapse to a `data-content` fingerprint on the svg
 *   element: path geometry is print noise, but the fingerprint still flips
 *   when an icon's artwork actually changes.
 */
/**
 * 文件职责：实现 snapshot.ts 覆盖的客户端运行时测试支持行为与测试协作。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、快照、模拟服务器或类型生成。
 * 产品维度：通过可复现的客户端运行时测试支持能力保障 Agent 功能在集成层稳定。
 * 逻辑维度：准备夹具或输入，执行装载/生成/调用流程，再规范化并核对结果。
 * 关键边界：夹具必须确定且跨平台；模型可见状态应可重放；临时资源必须释放。
 * 新手阅读建议：先看导出类型和夹具，再读主流程，最后关注规范化、失败和清理。
 */
import { expect } from 'vitest'
import type { SnapshotSerializer } from 'vitest'

/** One scoped class token: `_<local>_<hash>` (local may itself contain underscores). */
/** 中文说明：常量 SCOPED_CLASS 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const SCOPED_CLASS = /^_(.+)_[a-z0-9]+$/

/** Fold scoped tokens in one class attribute value; foreign tokens pass through. */
/** 中文说明：函数 normalizeClassValue 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function normalizeClassValue(value: string): string {
  return value
    .split(/\s+/)
    .filter(token => token !== '')
    .map(token => token.replace(SCOPED_CLASS, '$1'))
    .join(' ')
}

/** FNV-1a 32-bit over the svg markup: deterministic, dependency-free fingerprint. */
/** 中文说明：函数 fingerprint 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function fingerprint(markup: string): string {
  /** 中文说明：变量 hash 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let hash = 0x811c9dc5
  /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
  for (let i = 0; i < markup.length; i++) {
    hash ^= markup.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** svg elements of a subtree, the root included when it is one. */
/** 中文说明：函数 svgsOf 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function svgsOf(root: Element): Element[] {
  /** 中文说明：变量 svgs 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const svgs: Element[] = [...root.querySelectorAll('svg')]
  if (root.tagName.toLowerCase() === 'svg') svgs.unshift(root)
  return svgs
}

/** Whether serializing this subtree needs a normalized clone. */
/** 中文说明：函数 needsNormalization 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function needsNormalization(root: Element): boolean {
  /** 中文说明：函数值 scoped 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const scoped = [root, ...root.querySelectorAll('[class]')].some((el) => {
    /** 中文说明：变量 value 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const value = el.getAttribute('class')
    return value !== null && value.split(/\s+/).some(token => SCOPED_CLASS.test(token))
  })
  return scoped || svgsOf(root).some(svg => svg.childNodes.length > 0)
}

/**
 * The serializer plugin. Matches DOM elements whose subtree carries a scoped
 * class or svg internals; serializes a normalized clone, which no longer
 * matches, so printing falls through to the built-in DOM element serializer.
 */
/** 中文说明：变量 domSnapshotSerializer 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
export const domSnapshotSerializer: SnapshotSerializer = {
  test(value: unknown): boolean {
    return typeof Element !== 'undefined' && value instanceof Element && needsNormalization(value)
  },
  serialize(value, config, indentation, depth, refs, printer): string {
    /** 中文说明：变量 clone 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const clone = (value as Element).cloneNode(true) as Element
    /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
    for (const el of [clone, ...clone.querySelectorAll('[class]')]) {
      /** 中文说明：变量 raw 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const raw = el.getAttribute('class')
      if (raw !== null) el.setAttribute('class', normalizeClassValue(raw))
    }
    /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
    for (const svg of svgsOf(clone)) {
      if (svg.childNodes.length === 0) continue
      svg.setAttribute('data-content', fingerprint(svg.innerHTML))
      svg.replaceChildren()
    }
    return printer(clone, config, indentation, depth, refs)
  },
}

/** 中文说明：变量 registered 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let registered = false

/**
 * Register {@link domSnapshotSerializer} with vitest's expect (idempotent).
 * SlotTestRuntime.create() calls this; specs that snapshot DOM outside the
 * runtime import and call it themselves.
 */
/** 中文说明：函数 registerDomSnapshotSerializer 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function registerDomSnapshotSerializer(): void {
  if (registered) return
  registered = true
  expect.addSnapshotSerializer(domSnapshotSerializer)
}
