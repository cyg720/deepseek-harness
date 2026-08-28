/**
 * Display projection of reference forms in sent user text (bubble and queue
 * rows). The logged model text remains the single truth; this is presentation
 * only, and every part renders inline so a single-line message never breaks
 * across lines. Three decoration sources, by precedence: the wire session form
 * `@[label](dsh-session:...)` folds to its label; exact session labels
 * supplied by an adjacent recall decorate their bare `@label` mention; and
 * plain `/name` / `@name` word-boundary tokens decorate by shape alone (sent
 * tokens were validated at compose time).
 * @remarks 文件说明：文件职责：实现 client/ui-primitives 中 user text 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript、React 与项目的插件化客户端组件体系，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的 client/ui-primitives
 * 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import type { ReactNode } from 'react'
import { ReferenceIcon } from './ReferenceIcon.tsx'
import css from './user-text.module.css'

/** The wire form a session chip serializes to; label is the display text.
 * @remarks 中文说明：常量说明：SESSION_WIRE_RE 用于处理 SESSION_WIRE_RE 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
const SESSION_WIRE_RE = /@\[([^\]\n]+)\]\(dsh-session:[^)\s]+\)/gu

interface DecorationRange {
  readonly start: number
  readonly end: number
  /** Matched source text (hover title). */
  readonly label: string
  readonly kind: 'session' | 'plain'
  /** Pre-resolved display text (wire folds); derived from label when absent. */
  readonly display?: string
}

/**
 * Split one sent text into inline plain runs and reference chips.
 * @param text - the logged model text of the message or queue row.
 * @param sessionLabels - exact session mention labels associated by an adjacent recall.
 * @returns inline nodes covering the whole text.
 * @remarks 中文说明：功能说明：处理 projectUserText 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：text（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：sessionLabels（readonly string[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：ReactNode；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * projectUserText(text, sessionLabels)，并按返回类型处理结果。
 */
export function projectUserText(text: string, sessionLabels: readonly string[]): ReactNode {
  /**
   * 常量说明：ranges 用于处理 ranges 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const ranges: DecorationRange[] = []
  SESSION_WIRE_RE.lastIndex = 0
  /**
   * 变量说明：wire 用于处理 wire 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let wire: RegExpExecArray | null
  while ((wire = SESSION_WIRE_RE.exec(text)) !== null) {
    ranges.push({
      start: wire.index,
      end: wire.index + wire[0].length,
      label: wire[0],
      kind: 'session',
      display: wire[1] as string, // non-optional capture in SESSION_WIRE_RE
    })
  }
  /**
   * 变量说明：rawLabel 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：a（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：b（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(a, b)，并按返回类型处理结果。
   */
  for (const rawLabel of [...new Set(sessionLabels)].sort((a, b) => b.length - a.length)) {
    /**
     * 常量说明：label 用于处理 label 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const label = `@${rawLabel}`
    /**
     * 变量说明：start 用于启动 start 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let start = text.indexOf(label)
    while (start >= 0) {
      ranges.push({ start, end: start + label.length, label, kind: 'session' })
      start = text.indexOf(label, start + label.length)
    }
  }
  /**
   * 常量说明：re 用于处理 re 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const re = /(^|\s)(\/[\w-]+|@"[^"\n]+"|@[^\s]+)/gu
  /**
   * 变量说明：m 用于处理 m 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    /**
     * 常量说明：tokenStart 用于处理 tokenStart 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const tokenStart = m.index + (m[1] as string).length // (^|\s) captures '' at line start
    /**
     * 常量说明：rawLabel 用于处理 rawLabel 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const rawLabel = m[2] as string // non-optional alternation capture
    /**
     * 常量说明：label 用于处理 label 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const label = rawLabel.startsWith('@"')
      ? rawLabel
      : rawLabel.replace(/[.,;:!?，。；：！？]+$/gu, '')
    if (label.length <= 1) continue
    ranges.push({ start: tokenStart, end: tokenStart + label.length, label, kind: 'plain' })
  }
  /**
   * 常量说明：rankOf 用于处理 rankOf 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 rankOf 相关流程；使用场景由所在模块及调用位置决定。
   * @param range （DecorationRange）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns number；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 rankOf(range)，并按返回类型处理结果。
   */
  const rankOf = (range: DecorationRange): number => range.kind === 'session' ? 0 : 1
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：a（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：b（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(a, b)，并按返回类型处理结果。
   */
  ranges.sort((a, b) => a.start - b.start || rankOf(a) - rankOf(b) || b.end - a.end)
  /**
   * 常量说明：parts 用于处理 parts 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const parts: ReactNode[] = []
  /**
   * 变量说明：cursor 用于处理 cursor 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let cursor = 0
  /**
   * 常量说明：pushPlain 用于处理 pushPlain 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 pushPlain 相关流程；使用场景由所在模块及调用位置决定。
   * @param from （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param to （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 pushPlain(from, to)，并按返回类型处理结果。
   */
  const pushPlain = (from: number, to: number): void => {
    parts.push(<span key={`t${from}`} className={css.plainRun}>{text.slice(from, to)}</span>)
  }
  /**
   * 变量说明：range 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const range of ranges) {
    if (range.start < cursor) continue
    /**
     * 常量说明：tokenStart、end、label、kind 用于处理 tokenStart、end、label、kind 相关数据，
     * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { start: tokenStart, end, label, kind } = range
    if (tokenStart > cursor) pushPlain(cursor, tokenStart)
    /**
     * 常量说明：referenceKind 用于处理 referenceKind 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const referenceKind = kind === 'session'
      ? 'session'
      : label.startsWith('@')
        ? label.endsWith('/') ? 'folder' : 'file'
        : undefined
    /**
     * 常量说明：displayLabel 用于处理 displayLabel 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const displayLabel = range.display
      ?? (referenceKind === undefined
        ? label
        : referenceKind === 'session'
          ? label.slice(1)
          : label.slice(1).replace(/^"|"$/gu, '').split(/[\\/]/u).filter(Boolean).at(-1) ?? label.slice(1))
    parts.push(
      <span
        key={tokenStart}
        className={css.refChip}
        data-ref-chip={referenceKind ?? 'skill'}
        title={label}
      >
        {referenceKind !== undefined && (
          <ReferenceIcon kind={referenceKind} size={16} className={css.refIcon} />
        )}
        {displayLabel}
      </span>,
    )
    cursor = end
  }
  if (parts.length === 0) return <span className={css.plainRun}>{text}</span>
  if (cursor < text.length) pushPlain(cursor, text.length)
  return <>{parts}</>
}
