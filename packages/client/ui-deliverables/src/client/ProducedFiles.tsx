import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { HostObservable, InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import { basename } from './turn-deliverables.ts'
import type { NS } from './locales.ts'
import css from './ProducedFiles.module.css'

/** At most six chips compete for the one-line summary; every other path stays counted. */
/* 中文说明：组件局部值 SHOWN_LIMIT，由紧邻初始化决定。 */
const SHOWN_LIMIT = 6

/**
 * Select the largest prefix whose measured chips and exact remainder fit.
 * @param available - usable width of the one-line file lane.
 * @param gap - computed flex gap between adjacent visible items.
 * @param chipWidths - measured widths for the candidate file chips.
 * @param moreWidthsByShown - exact localized remainder width for each shown count.
 * @returns Number of leading chips to render.
 */
/* 中文说明：函数 fitProducedFiles 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function fitProducedFiles(
  available: number,
  gap: number,
  chipWidths: readonly number[],
  moreWidthsByShown: readonly (number | undefined)[],
): number {
  if (available <= 0) return chipWidths.length
  /** 中文说明：组件局部值 prefix，由紧邻初始化决定。 */
  const prefix = [0]
  /** 中文说明：组件局部值 prefixWidth，由紧邻初始化决定。 */
  let prefixWidth = 0
  /** 中文说明：组件局部值 width，由紧邻初始化决定。 */
  for (const width of chipWidths) {
    prefixWidth += width
    prefix.push(prefixWidth)
  }
  /** 中文说明：组件局部值 largestFit，由紧邻初始化决定。 */
  let largestFit = 0
  /** 中文说明：组件局部值 [shown，由紧邻初始化决定。 */
  for (const [shown, width] of prefix.entries()) {
    /** 中文说明：组件局部值 more，由紧邻初始化决定。 */
    const more = moreWidthsByShown[shown]
    /** 中文说明：组件局部值 items，由紧邻初始化决定。 */
    const items = shown + (more === undefined ? 0 : 1)
    /** 中文说明：组件局部值 needed，由紧邻初始化决定。 */
    const needed = width + (more ?? 0) + Math.max(0, items - 1) * gap
    if (needed <= available) largestFit = shown
  }
  return largestFit
}

/** Registration-side Host capability facts. */
/* 中文说明：类型或类 ProducedFilesInjected 约束本文件数据或组件职责。 */
export interface ProducedFilesInjected {
  /** Whether the browser itself is connected over loopback. */
  isLoopback: boolean
  /** Load the opener capability when this row first reaches the page. */
  ensureWorkspacePathOpen(): void
  hooks: {
    /** Current generation's Session workspace opener capability. */
    workspacePathOpen: HostObservable<boolean | undefined>
  }
}

/** Matched paths plus the opener, locale, and injected Host capability. */
/* 中文说明：类型或类 ProducedFilesProps 约束本文件数据或组件职责。 */
export type ProducedFilesProps = Pick<TurnTailOwnerProps, 'openFile'> & {
  matched: readonly string[]
} & PropsLocale<typeof NS> & InjectFace<ProducedFilesInjected>

/** 中文说明：函数 moreLabel 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function moreLabel(t: ProducedFilesProps['t'], count: number): string {
  return count === 1 ? t('produced.moreOne') : t('produced.more', { count: String(count) })
}

/**
 * Render one turn's produced files as openable chips.
 * @param props - selector-matched paths, the chat view's file opener, and the locale seat.
 * @returns The produced-files row.
 */
/* 中文说明：函数 ProducedFiles 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function ProducedFiles({
  matched: paths, openFile, isLoopback, ensureWorkspacePathOpen, useWorkspacePathOpen, t,
}: ProducedFilesProps) {
  useEffect(() => { ensureWorkspacePathOpen() }, [ensureWorkspacePathOpen])
  const hostCanOpenPath = useWorkspacePathOpen(available => available === true)
  const canOpenPath = isLoopback && hostCanOpenPath
  /** 中文说明：组件局部值 limit，由紧邻初始化决定。 */
  const limit = Math.min(paths.length, SHOWN_LIMIT)
  /** 中文说明：组件局部值 解构结果，由紧邻初始化决定。 */
  const [shownCount, setShownCount] = useState(limit)
  /** 中文说明：组件局部值 rowRef，由紧邻初始化决定。 */
  const rowRef = useRef<HTMLDivElement>(null)
  /** 中文说明：组件局部值 chipProbes，由紧邻初始化决定。 */
  const chipProbes = useRef<Array<HTMLButtonElement | null>>([])
  /** 中文说明：组件局部值 moreProbe，由紧邻初始化决定。 */
  const moreProbe = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    /** 中文说明：组件局部值 row，由紧邻初始化决定。 */
    const row = rowRef.current
    /** 中文说明：组件局部值 remainderProbe，由紧邻初始化决定。 */
    const remainderProbe = moreProbe.current
    /* v8 ignore next -- React attaches both refs before the layout effect runs. */
    if (row === null || remainderProbe === null) return
    /** 中文说明：组件局部值 measure，由紧邻初始化决定。 */
    const measure = (): void => {
      /** 中文说明：组件局部值 styles，由紧邻初始化决定。 */
      const styles = getComputedStyle(row)
      /** 中文说明：组件局部值 gap，由紧邻初始化决定。 */
      const gap = Number.parseFloat(styles.columnGap || styles.gap) || 0
      // React attaches every still-mounted callback ref before layout effects run.
      /** 中文说明：组件局部值 activeChipProbes，由紧邻初始化决定。 */
      const activeChipProbes = chipProbes.current.slice(0, limit) as HTMLButtonElement[]
      /** 中文说明：组件局部值 chips，由紧邻初始化决定。 */
      const chips = activeChipProbes.map(probe => probe.getBoundingClientRect().width)
      /** 中文说明：组件局部值 more，由紧邻初始化决定。 */
      const more = Array.from({ length: limit + 1 }, (_, candidate) => {
        if (paths.length === candidate) return undefined
        remainderProbe.textContent = moreLabel(t, paths.length - candidate)
        return remainderProbe.getBoundingClientRect().width
      })
      setShownCount(fitProducedFiles(row.clientWidth, gap, chips, more))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    /** 中文说明：组件局部值 observer，由紧邻初始化决定。 */
    const observer = new ResizeObserver(measure)
    observer.observe(row)
    /** 中文说明：组件局部值 probe，由紧邻初始化决定。 */
    for (const probe of [...chipProbes.current, moreProbe.current]) {
      if (probe !== null) observer.observe(probe)
    }
    return () => { observer.disconnect() }
  }, [limit, paths, t])

  /** 中文说明：组件局部值 visibleCount，由紧邻初始化决定。 */
  const visibleCount = Math.min(shownCount, limit)
  /** 中文说明：组件局部值 shown，由紧邻初始化决定。 */
  const shown = paths.slice(0, visibleCount)
  /** 中文说明：组件局部值 hidden，由紧邻初始化决定。 */
  const hidden = paths.length - shown.length
  return (
    <div className={css.root}>
      <span className={css.label}>{t('produced.label')}</span>
      <div ref={rowRef} className={css.row} data-produced-files-row>
        {shown.map(path => (
          <button
            key={path}
            type="button"
            className={css.file}
            // The full path is the disambiguator when two turns produce files
            // that share a basename; the chip itself stays short.
            title={path}
            aria-label={t('produced.open', { name: path })}
            onClick={() => { openFile(path) }}
          >
            {basename(path)}
          </button>
        ))}
        {hidden > 0 && <span className={css.more}>{moreLabel(t, hidden)}</span>}
      </div>
      {hidden > 0 && canOpenPath && (
        <button type="button" className={css.showFolder} onClick={() => { openFile('.') }}>
          {t('produced.showInFolder')}
        </button>
      )}
      <div className={css.measure} aria-hidden="true">
        {paths.slice(0, limit).map((path, index) => (
          <button
            key={path}
            ref={(node) => { chipProbes.current[index] = node }}
            type="button"
            tabIndex={-1}
            className={`${css.file} ${css.probe}`}
          >
            {basename(path)}
          </button>
        ))}
        <span ref={moreProbe} className={`${css.more} ${css.probe}`} />
      </div>
    </div>
  )
}
