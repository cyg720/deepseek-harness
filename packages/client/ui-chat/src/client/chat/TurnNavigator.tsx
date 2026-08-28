/**
 * 文件职责：实现 client/ui-chat 中 TurnNavigator 模块的职责，并向相邻模块提供可复用能力。
 * 技术维度：主要使用TypeScript、React 与项目的插件化客户端组件体系，通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：支撑 DeepSeek Harness 的 client/ui-chat 能力，使上层功能能够稳定组合和扩展。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import {
  memo, useId, useState, type CSSProperties, type MouseEvent, type PointerEvent,
} from 'react'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import type { TurnNavigationItem } from '../contract/snapshot.ts'
import css from './TurnNavigator.module.css'

interface TurnNavigatorProps {
  readonly items: readonly TurnNavigationItem[]
  readonly activeTurn: number | null
  readonly onNavigate: (item: TurnNavigationItem) => void
  readonly t: ChatViewSlotProps['t']
}

/** Resting gap between neighbouring marks before the rail compresses to fit.
 * @remarks 中文说明：常量说明：TURN_SPACING_PX 用于处理 TURN_SPACING_PX 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
const TURN_SPACING_PX = 10
/** Rail padding above the first mark and below the last one, per end.
 * @remarks 中文说明：常量说明：RAIL_INSET_PX 用于处理 RAIL_INSET_PX 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
const RAIL_INSET_PX = 6

type TurnPositionStyle = CSSProperties & {
  readonly '--turn-natural-position': string
  readonly '--turn-position': string
}

type TurnRailStyle = CSSProperties & {
  readonly '--turn-natural-height': string
  readonly '--turn-rail-inset': string
}

/**
 * 功能说明：处理 itemPosition 相关流程；使用场景由所在模块及调用位置决定。
 * @param index （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param count （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns TurnPositionStyle；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 itemPosition(index, count)，并按返回类型处理结果。
 */
function itemPosition(index: number, count: number): TurnPositionStyle {
  /**
   * 常量说明：ratio 用于处理 ratio 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const ratio = count <= 1 ? 0 : index / (count - 1)
  return {
    '--turn-natural-position': `${String(index * TURN_SPACING_PX)}px`,
    '--turn-position': `${String(ratio * 100)}%`,
  }
}

/**
 * 功能说明：处理 railSize 相关流程；使用场景由所在模块及调用位置决定。
 * @param count （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns TurnRailStyle；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 railSize(count)，并按返回类型处理结果。
 */
function railSize(count: number): TurnRailStyle {
  return {
    '--turn-natural-height': `${String((count - 1) * TURN_SPACING_PX + 2 * RAIL_INSET_PX)}px`,
    '--turn-rail-inset': `${String(RAIL_INSET_PX)}px`,
  }
}

/**
 * 功能说明：处理 itemAtPointer 相关流程；使用场景由所在模块及调用位置决定。
 * @param items （readonly TurnNavigationItem[]）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @param rail （HTMLElement）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param clientY （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns TurnNavigationItem | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 itemAtPointer(items, rail, clientY)，并按返回类型处理结果。
 */
function itemAtPointer(
  items: readonly TurnNavigationItem[],
  rail: HTMLElement,
  clientY: number,
): TurnNavigationItem | undefined {
  /**
   * 常量说明：rect 用于处理 rect 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const rect = rail.getBoundingClientRect()
  /**
   * 常量说明：usableHeight 用于处理 usableHeight 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const usableHeight = Math.max(1, rect.height - 2 * RAIL_INSET_PX)
  /**
   * 常量说明：ratio 用于处理 ratio 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const ratio = Math.max(0, Math.min(1, (clientY - rect.top - RAIL_INSET_PX) / usableHeight))
  return items[Math.round(ratio * (items.length - 1))]
}

/**
 * 功能说明：处理 TurnNavigatorRail 相关流程；使用场景由所在模块及调用位置决定。
 * @param { items, activeTurn, onNavigate, t }
 * （TurnNavigatorProps）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 TurnNavigatorRail({ items, activeTurn…)，并按返回类型处理结果。
 */
function TurnNavigatorRail({ items, activeTurn, onNavigate, t }: TurnNavigatorProps) {
  /**
   * 常量说明：previewTurn、setPreviewTurn 用于处理 previewTurn、setPreviewTurn 相关数据，
   * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const [previewTurn, setPreviewTurn] = useState<number | null>(null)
  /**
   * 常量说明：previewId 用于处理 previewId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const previewId = useId()
  if (items.length < 2) return null
  /**
   * 常量说明：previewIndex 用于处理 previewIndex 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
   */
  const previewIndex = items.findIndex(item => item.turn === previewTurn)
  /**
   * 常量说明：preview 用于处理 preview 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const preview = previewIndex < 0 ? undefined : items[previewIndex]
  /**
   * 常量说明：previewPosition 用于处理 previewPosition 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const previewPosition = previewIndex < 0 ? undefined : itemPosition(previewIndex, items.length)
  /**
   * 常量说明：previewAtPointer 用于处理 previewAtPointer 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 previewAtPointer 相关流程；使用场景由所在模块及调用位置决定。
   * @param event （PointerEvent<HTMLElement>）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 previewAtPointer(event)，并按返回类型处理结果。
   */
  const previewAtPointer = (event: PointerEvent<HTMLElement>): void => {
    setPreviewTurn(itemAtPointer(items, event.currentTarget, event.clientY)?.turn ?? null)
  }
  /**
   * 常量说明：navigateAtPointer 用于处理 navigateAtPointer 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 navigateAtPointer 相关流程；使用场景由所在模块及调用位置决定。
   * @param event （MouseEvent<HTMLElement>）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 navigateAtPointer(event)，并按返回类型处理结果。
   */
  const navigateAtPointer = (event: MouseEvent<HTMLElement>): void => {
    /**
     * 常量说明：item 用于处理 item 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const item = itemAtPointer(items, event.currentTarget, event.clientY)
    if (item !== undefined) onNavigate(item)
  }
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：index（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item, index)，并按返回类型处理结果。
   */
  return (
    <div className={css.slot}>
      <nav
        className={css.rail}
        style={railSize(items.length)}
        aria-label={t('chat.turnNavigation.label')}
        onClick={navigateAtPointer}
        onPointerMove={previewAtPointer}
        onPointerLeave={() => { setPreviewTurn(null) }}
      >
        <div className={css.marks}>
          {items.map((item, index) => {
            /**
             * 常量说明：active 用于处理 active 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
             */
            const active = item.turn === activeTurn
            /**
             * 常量说明：showingPreview 用于处理 showingPreview 相关数据，作用于当前作用域；初始化后不可重新赋值，
             * 但对象内部是否可变仍由其类型决定。
             */
            const showingPreview = item.turn === previewTurn
            /**
             * 常量说明：markClass 用于处理 markClass 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
             */
            const markClass = active
              ? `${css.mark} ${css.markActive}`
              : showingPreview ? `${css.mark} ${css.markPreview}` : css.mark
            /**
             * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
             * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
             * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
             */
            /**
             * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
             * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
             */
            /**
             * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
             * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
             */
            return (
              <div key={item.turn} className={css.markPosition} style={itemPosition(index, items.length)}>
                <button
                  type="button"
                  className={markClass}
                  aria-label={t('chat.turnNavigation.jump', { turn: item.turn })}
                  aria-current={active ? 'true' : undefined}
                  aria-describedby={showingPreview ? previewId : undefined}
                  onClick={(event) => {
                    event.stopPropagation()
                    onNavigate(item)
                  }}
                  onFocus={() => { setPreviewTurn(item.turn) }}
                  onBlur={() => { setPreviewTurn(null) }}
                />
              </div>
            )
          })}
        </div>
        {preview !== undefined && previewPosition !== undefined && (
          <div id={previewId} role="tooltip" className={css.preview} style={previewPosition}>
            <div className={css.previewPrompt}>
              {preview.prompt || t('chat.turnNavigation.turn', { turn: preview.turn })}
            </div>
            {preview.response !== '' && <div className={css.previewResponse}>{preview.response}</div>}
          </div>
        )}
      </nav>
    </div>
  )
}

/**
 * Compact rail of the currently loaded Turns with hover and focus previews.
 *
 * Memoized because it renders two host elements per loaded Turn while the
 * enclosing view re-renders on every streaming delta: without the guard a long
 * session rebuilds hundreds of marks per commit for a rail that only changes
 * when a Turn is added, removed, or becomes active. Its props must therefore
 * stay referentially stable across those commits.
 * @remarks 中文说明：常量说明：TurnNavigator 用于处理 TurnNavigator 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
export const TurnNavigator = memo(TurnNavigatorRail)
