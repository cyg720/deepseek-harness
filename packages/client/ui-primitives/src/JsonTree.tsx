/**
 * 文件职责：实现JSON 数据相关的 JsonTree 基础组件。
 * 技术维度：React、TypeScript、CSS Modules 和浏览器 DOM API。
 * 产品维度：为上层产品界面提供一致的JSON 数据展示。
 * 逻辑维度：接收属性，派生展示结构并处理局部交互。
 * 关键边界：组件不拥有业务状态；不可信内容必须经过既有安全渲染路径。
 * 新手阅读建议：先读 Props，再看派生值、事件处理和 JSX。
 */
import clsx from 'clsx'
import { useEffect, useId, useRef, useState } from 'react'
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  UIEvent as ReactUIEvent,
} from 'react'
import { IconCheckOutline16, IconCopyOutline16 } from './icons/index.tsx'
import { Menu } from './Menu.tsx'
import type { MenuEntry } from './Menu.tsx'
import css from './JsonTree.module.css'

/** 中文说明：组件局部值 OBJECT_PREVIEW_LIMIT，由紧邻初始化决定。 */
const OBJECT_PREVIEW_LIMIT = 4
/** 中文说明：组件局部值 ARRAY_PREVIEW_LIMIT，由紧邻初始化决定。 */
const ARRAY_PREVIEW_LIMIT = 5
/** 中文说明：组件局部值 PREVIEW_DEPTH_LIMIT，由紧邻初始化决定。 */
const PREVIEW_DEPTH_LIMIT = 2

/**
 * Display copy for the tree's copy affordance; the owner passes localized
 * labels (this package is cordis-free, so copy arrives via props).
 */
/* 中文说明：类型或类 JsonTreeLabels 约束基础组件的数据或职责。 */
export interface JsonTreeLabels {
  /** Menu item: copy the raw primitive value. */
  copyValue: string
  /** Menu item: copy the value as compact JSON (primitive rows). */
  copyJson: string
  /** Menu item: copy the property path. */
  copyPath: string
  /** Menu item: copy the value as pretty-printed JSON. */
  copyPrettyJson: string
  /** Menu item: copy the value as compact JSON (object rows). */
  copyCompactJson: string
  /** Copy-button state label after a successful copy. */
  copied: string
  /** Copy-button state label after a failed copy. */
  copyFailed: string
  /** Expander aria label while expanded. */
  collapseNode: string
  /** Expander aria label while collapsed. */
  expandNode: string
  /** Copy-button tooltip, given the current action label. */
  copyButtonTitle: (action: string) => string
}

function valueCopyMenuItems(labels: JsonTreeLabels): readonly MenuEntry[] {
  return [
    { id: 'value', label: labels.copyValue },
    { id: 'json', label: labels.copyJson },
    { id: 'path', label: labels.copyPath },
  ]
}

/** 中文说明：函数 objectCopyMenuItems 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function objectCopyMenuItems(labels: JsonTreeLabels): readonly MenuEntry[] {
  return [
    { id: 'prettyJson', label: labels.copyPrettyJson },
    { id: 'json', label: labels.copyCompactJson },
    { id: 'path', label: labels.copyPath },
  ]
}

/** 中文说明：类型或类 JsonPath 约束基础组件的数据或职责。 */
type JsonPath = readonly (number | string)[]

/** 中文说明：类型或类 RowTarget 约束基础组件的数据或职责。 */
interface RowTarget {
  path: JsonPath
  value: unknown
}

/** 中文说明：类型或类 CopyTarget 约束基础组件的数据或职责。 */
interface CopyTarget extends RowTarget {
  left: number
  side: 'bottom' | 'top'
  top: number
}

/** 中文说明：函数 isExpandableValue 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function isExpandableValue(value: unknown): value is object | unknown[] {
  return typeof value === 'object' && value !== null && !(value instanceof Date)
}

/** 中文说明：函数 entriesOf 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function entriesOf(value: object | unknown[]): readonly (readonly [string, unknown])[] {
  if (Array.isArray(value)) {
    return value.map((item, index) => [String(index), item] as const)
  }
  return Object.keys(value).map(key => [
    key,
    (value as Record<string, unknown>)[key],
  ] as const)
}

/** 中文说明：函数 bracketOf 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function bracketOf(value: object | unknown[]): readonly [string, string] {
  return Array.isArray(value) ? ['[', ']'] : ['{', '}']
}

/** 中文说明：函数 previewPrimitive 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function previewPrimitive(value: unknown): ReactNode {
  if (value === null) return <span className={css.keywordValue}>null</span>
  if (typeof value === 'string') {
    return <span className={css.stringValue}>{JSON.stringify(value)}</span>
  }
  if (typeof value === 'number') {
    return <span className={css.numberValue}>{String(value)}</span>
  }
  if (typeof value === 'boolean') {
    return <span className={css.keywordValue}>{String(value)}</span>
  }
  if (typeof value === 'bigint') {
    return <span className={css.otherValue}>{value.toString()}</span>
  }
  if (typeof value === 'undefined') {
    return <span className={css.otherValue}>undefined</span>
  }
  if (typeof value === 'symbol') {
    return <span className={css.otherValue}>{value.description ?? 'Symbol'}</span>
  }
  if (typeof value === 'function') {
    return <span className={css.otherValue}>{value.name || 'Function'}</span>
  }
  return null
}

/** 中文说明：函数 previewValue 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function previewValue(value: unknown, depth: number): ReactNode {
  if (!isExpandableValue(value)) return previewPrimitive(value)

  /** 中文说明：组件局部值 array，由紧邻初始化决定。 */
  const array = Array.isArray(value)
  /** 中文说明：组件局部值 entries，由紧邻初始化决定。 */
  const entries = entriesOf(value)
  /** 中文说明：组件局部值 limit，由紧邻初始化决定。 */
  const limit = array ? ARRAY_PREVIEW_LIMIT : OBJECT_PREVIEW_LIMIT
  /** 中文说明：组件局部值 visible，由紧邻初始化决定。 */
  const visible = entries.slice(0, limit)
  /** 中文说明：组件局部值 [open, close]，由紧邻初始化决定。 */
  const [open, close] = bracketOf(value)

  return (
    <>
      <span className={css.punctuation}>{open}</span>
      {depth >= PREVIEW_DEPTH_LIMIT
        ? <span className={css.previewEllipsis}>…</span>
        : visible.map(([key, item], index) => (
          <span key={key}>
            {index > 0 && <span className={css.punctuation}>, </span>}
            {!array && (
              <>
                <span className={css.previewProperty}>{key}</span>
                <span className={css.punctuation}>: </span>
              </>
            )}
            {previewValue(item, depth + 1)}
          </span>
        ))}
      {depth < PREVIEW_DEPTH_LIMIT && entries.length > limit && (
        <span className={css.previewEllipsis}>, …</span>
      )}
      <span className={css.punctuation}>{close}</span>
    </>
  )
}

/** 中文说明：函数 primitiveValue 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function primitiveValue(value: unknown): ReactNode {
  if (value === null) return <span className={css.keywordValue}>null</span>
  if (typeof value === 'string') {
    return <span className={css.stringValue}>{JSON.stringify(value)}</span>
  }
  if (typeof value === 'boolean') {
    return <span className={css.keywordValue}>{String(value)}</span>
  }
  if (typeof value === 'number') {
    return <span className={css.numberValue}>{String(value)}</span>
  }
  if (typeof value === 'bigint') {
    return <span className={css.numberValue}>{`${value.toString()}n`}</span>
  }
  if (value instanceof Date) {
    return <span className={css.otherValue}>{value.toISOString()}</span>
  }
  if (typeof value === 'function') {
    return <span className={css.otherValue}>function() {'{ }'}</span>
  }
  if (typeof value === 'undefined') {
    return <span className={css.otherValue}>undefined</span>
  }
  return <span className={css.otherValue}>{(value as symbol).toString()}</span>
}

/** 中文说明：函数 fieldText 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function fieldText(field: string): string {
  return field === '' ? '""' : field
}

/** 中文说明：函数 pathId 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function pathId(path: JsonPath): string {
  return path.map(part => (
    typeof part === 'number' ? `n${String(part)}` : `s${String(part.length)}:${part}`
  )).join('/')
}

/** 中文说明：函数 claimFocus 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function claimFocus(button: HTMLElement): void {
  button.focus()
}

/** 中文说明：函数 moveFocus 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function moveFocus(button: HTMLElement, direction: -1 | 1): void {
  /** 中文说明：组件局部值 tree，由紧邻初始化决定。 */
  const tree = button.closest<HTMLElement>('[role="tree"]')
  /* v8 ignore next -- JsonTree attaches expander handlers only beneath its owning role=tree. */
  if (tree === null) return
  /** 中文说明：组件局部值 expanders，由紧邻初始化决定。 */
  const expanders = Array.from(tree.querySelectorAll<HTMLElement>('[data-json-expander]'))
  /** 中文说明：组件局部值 current，由紧邻初始化决定。 */
  const current = expanders.indexOf(button)
  /* v8 ignore next -- the current expander is a member of the queried non-empty set. */
  if (current < 0 || expanders.length === 0) return
  /** 中文说明：组件局部值 next，由紧邻初始化决定。 */
  const next = (current + direction + expanders.length) % expanders.length
  /** 中文说明：组件局部值 nextExpander，由紧邻初始化决定。 */
  const nextExpander = expanders[next]
  /* v8 ignore next -- modulo over the non-empty expander set always resolves a member. */
  if (nextExpander !== undefined) claimFocus(nextExpander)
}

/** 中文说明：函数 NodeField 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function NodeField({
  field,
  expandable,
  onToggle,
}: {
  field: string | undefined
  expandable: boolean
  onToggle: () => void
}) {
  if (field === undefined) return null
  return (
    <span
      className={clsx(css.label, expandable && css.clickableLabel)}
      onClick={expandable ? onToggle : undefined}
    >
      {fieldText(field)}:
    </span>
  )
}

/** 中文说明：类型或类 JsonTreeNodeProps 约束基础组件的数据或职责。 */
interface JsonTreeNodeProps {
  field?: string
  initialExpanded: boolean
  labels: JsonTreeLabels
  lastElement: boolean
  onClaimTabStop: (id: string) => void
  onRowHover: (row: HTMLElement, target: RowTarget) => void
  path: JsonPath
  tabStopId: string | null
  value: unknown
}

/** 中文说明：函数 JsonTreeNode 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function JsonTreeNode({
  field,
  initialExpanded,
  labels,
  lastElement,
  onClaimTabStop,
  onRowHover,
  path,
  tabStopId,
  value,
}: JsonTreeNodeProps) {
  /** 中文说明：组件局部值 contentsId，由紧邻初始化决定。 */
  const contentsId = useId()
  /** 中文说明：组件局部值 expanderRef，由紧邻初始化决定。 */
  const expanderRef = useRef<HTMLSpanElement>(null)
  /** 中文说明：组件局部值 [expanded, setExpanded]，由紧邻初始化决定。 */
  const [expanded, setExpanded] = useState(initialExpanded)
  /** 中文说明：组件局部值 nodeId，由紧邻初始化决定。 */
  const nodeId = pathId(path)
  /** 中文说明：组件局部值 container，由紧邻初始化决定。 */
  const container = isExpandableValue(value)
  /** 中文说明：组件局部值 entries，由紧邻初始化决定。 */
  const entries = container ? entriesOf(value) : []
  /** 中文说明：组件局部值 expandable，由紧邻初始化决定。 */
  const expandable = entries.length > 0

  /** 中文说明：组件局部值 toggle，由紧邻初始化决定。 */
  const toggle = () => {
    setExpanded(current => !current)
    claimFocus(expanderRef.current as HTMLSpanElement)
  }

  /** 中文说明：组件局部值 onExpanderKeyDown，由紧邻初始化决定。 */
  const onExpanderKeyDown = (event: ReactKeyboardEvent<HTMLSpanElement>) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      setExpanded(event.key === 'ArrowRight')
      return
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      moveFocus(event.currentTarget, event.key === 'ArrowUp' ? -1 : 1)
    }
  }

  /** 中文说明：组件局部值 row，由紧邻初始化决定。 */
  const row = (children: ReactNode, ariaExpanded?: boolean) => (
    <div
      className={css.row}
      role="treeitem"
      aria-expanded={ariaExpanded}
      onMouseOver={(event) => {
        event.stopPropagation()
        onRowHover(event.currentTarget, { path, value })
      }}
    >
      {children}
    </div>
  )

  if (!container) {
    return row((
      <>
        <NodeField field={field} expandable={false} onToggle={toggle} />
        {primitiveValue(value)}
        {!lastElement && <span className={css.punctuation}>,</span>}
      </>
    ))
  }

  /** 中文说明：组件局部值 [open, close]，由紧邻初始化决定。 */
  const [open, close] = bracketOf(value)
  if (!expandable) {
    return row((
      <>
        <NodeField field={field} expandable={false} onToggle={toggle} />
        <span className={css.punctuation}>{open}</span>
        <span className={css.punctuation}>{close}</span>
        {!lastElement && <span className={css.punctuation}>,</span>}
      </>
    ))
  }

  return row((
    <>
      <span
        ref={expanderRef}
        className={clsx(css.expander, expanded ? css.collapseIcon : css.expandIcon)}
        data-json-expander
        role="button"
        aria-label={expanded ? labels.collapseNode : labels.expandNode}
        aria-expanded={expanded}
        aria-controls={expanded ? contentsId : undefined}
        tabIndex={tabStopId === nodeId ? 0 : -1}
        onFocus={() => { onClaimTabStop(nodeId) }}
        onClick={toggle}
        onKeyDown={onExpanderKeyDown}
      />
      <NodeField field={field} expandable onToggle={toggle} />
      <span className={css.preview}>{previewValue(value, 0)}</span>
      {!lastElement && <span className={css.punctuation}>,</span>}
      {expanded && (
        <ul id={contentsId} role="group" className={css.children}>
          {entries.map(([key, item], index) => (
            <JsonTreeNode
              key={key}
              field={key}
              value={item}
              path={[...path, Array.isArray(value) ? index : key]}
              labels={labels}
              lastElement={index === entries.length - 1}
              initialExpanded={false}
              tabStopId={tabStopId}
              onClaimTabStop={onClaimTabStop}
              onRowHover={onRowHover}
            />
          ))}
        </ul>
      )}
    </>
  ), expanded)
}

/** 中文说明：函数 formattedPath 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function formattedPath(path: JsonPath): string {
  return path.reduce<string>((result, part) => {
    if (typeof part === 'number') return `${result}[${String(part)}]`
    return /^[A-Za-z_$][\w$]*$/.test(part)
      ? `${result}.${part}`
      : `${result}[${JSON.stringify(part)}]`
  }, '$')
}

/** 中文说明：函数 copyText 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function copyText(target: CopyTarget, mode: 'json' | 'path' | 'prettyJson' | 'value'): string {
  if (mode === 'path') return formattedPath(target.path)
  if (mode === 'prettyJson') return JSON.stringify(target.value, null, 2)
  if (mode === 'json') return JSON.stringify(target.value)
  if (typeof target.value === 'string') return target.value
  if (typeof target.value === 'undefined') return 'undefined'
  if (typeof target.value === 'bigint') return target.value.toString()
  if (typeof target.value === 'symbol') return target.value.description ?? 'Symbol'
  if (typeof target.value === 'function') return target.value.name || 'Function'
  return JSON.stringify(target.value)
}

/** Props for the read-only, token-themed JSON tree. */
/* 中文说明：类型或类 JsonTreeProps 约束基础组件的数据或职责。 */
export interface JsonTreeProps {
  /** Parsed JSON object or array. */
  data: object | unknown[]
  /** Accessible label for the tree. */
  label: string
  /** Optional positioning class owned by the caller. */
  className?: string | undefined
  /** Whether JSON rows expose copy actions. */
  copyable?: boolean
  /** Whether the top-level object or array is always expanded. */
  expandTopLevel?: boolean
  /** Localized display copy supplied by the owning render site. */
  labels: JsonTreeLabels
}

/**
 * Render parsed JSON as a compact, keyboard-accessible inspector tree.
 * @param props - Parsed data, accessible label, and display options.
 * @returns A read-only JSON tree with an optionally fixed-open top level.
 */
/* 中文说明：函数 JsonTree 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function JsonTree({
  data,
  label,
  className,
  copyable = true,
  expandTopLevel = true,
  labels,
}: JsonTreeProps) {
  const rootEntries = entriesOf(data)
  /** 中文说明：组件局部值 firstExpandableIndex，由紧邻初始化决定。 */
  const firstExpandableIndex = rootEntries.findIndex(([, value]) => (
    isExpandableValue(value) && entriesOf(value).length > 0
  ))
  /** 中文说明：组件局部值 firstExpandableEntry，由紧邻初始化决定。 */
  const firstExpandableEntry = rootEntries[firstExpandableIndex]
  /** 中文说明：组件局部值 initialTabStopId，由紧邻初始化决定。 */
  const initialTabStopId = expandTopLevel
    ? firstExpandableEntry === undefined
      ? null
      : pathId([Array.isArray(data) ? firstExpandableIndex : firstExpandableEntry[0]])
    : isExpandableValue(data) && rootEntries.length > 0 ? pathId([]) : null
  /** 中文说明：组件局部值 rootRef，由紧邻初始化决定。 */
  const rootRef = useRef<HTMLDivElement>(null)
  /** 中文说明：组件局部值 activeRowRef，由紧邻初始化决定。 */
  const activeRowRef = useRef<HTMLElement>()
  /** 中文说明：组件局部值 copyButtonRef，由紧邻初始化决定。 */
  const copyButtonRef = useRef<HTMLButtonElement>(null)
  /** 中文说明：组件局部值 copyMenuOpenRef，由紧邻初始化决定。 */
  const copyMenuOpenRef = useRef(false)
  /** 中文说明：组件局部值 resetTimer，由紧邻初始化决定。 */
  const resetTimer = useRef<ReturnType<typeof setTimeout>>()
  /** 中文说明：组件局部值 解构结果，由紧邻初始化决定。 */
  const [copyTarget, setCopyTarget] = useState<CopyTarget>()
  /** 中文说明：组件局部值 [copyState, setCopyState]，由紧邻初始化决定。 */
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  /** 中文说明：组件局部值 解构结果，由紧邻初始化决定。 */
  const [copyMenuOpen, setCopyMenuOpen] = useState(false)
  /** 中文说明：组件局部值 [tabStopId, setTabStopId]，由紧邻初始化决定。 */
  const [tabStopId, setTabStopId] = useState<string | null>(initialTabStopId)

  /** 中文说明：组件局部值 setActiveRow，由紧邻初始化决定。 */
  const setActiveRow = (row: HTMLElement | undefined) => {
    activeRowRef.current?.removeAttribute('data-json-copy-active')
    activeRowRef.current = row
    row?.setAttribute('data-json-copy-active', '')
  }

  /** 中文说明：组件局部值 clearCopyTarget，由紧邻初始化决定。 */
  const clearCopyTarget = () => {
    setActiveRow(undefined)
    setCopyTarget(undefined)
    setCopyState('idle')
    copyMenuOpenRef.current = false
    setCopyMenuOpen(false)
  }

  /** 中文说明：组件局部值 copyPosition，由紧邻初始化决定。 */
  const copyPosition = (row: HTMLElement): Pick<CopyTarget, 'left' | 'side' | 'top'> => {
    /** 中文说明：组件局部值 root，由紧邻初始化决定。 */
    const root = rootRef.current
    /* v8 ignore next -- row events and viewport listeners run only after the root ref mounts. */
    if (root === null) throw new Error('JsonTree root is not mounted')
    /** 中文说明：组件局部值 rootRect，由紧邻初始化决定。 */
    const rootRect = root.getBoundingClientRect()
    /** 中文说明：组件局部值 rowRect，由紧邻初始化决定。 */
    const rowRect = row.getBoundingClientRect()
    return {
      left: rootRect.left + root.clientWidth - 26,
      side: rowRect.top - rootRect.top > root.clientHeight / 2 ? 'top' : 'bottom',
      top: rowRect.top,
    }
  }

  /** 中文说明：组件局部值 positionCopyButton，由紧邻初始化决定。 */
  const positionCopyButton = (row: HTMLElement, target: RowTarget) => {
    /** 中文说明：组件局部值 position，由紧邻初始化决定。 */
    const position = copyPosition(row)
    setCopyTarget({ ...target, ...position })
  }

  /** 中文说明：组件局部值 repositionCopyButton，由紧邻初始化决定。 */
  const repositionCopyButton = (row: HTMLElement) => {
    /** 中文说明：组件局部值 position，由紧邻初始化决定。 */
    const position = copyPosition(row)
    setCopyTarget((current) => {
      /* v8 ignore next -- an active row and its copy target are installed together. */
      if (current === undefined) return current
      return { ...current, ...position }
    })
  }

  useEffect(() => () => {
    if (resetTimer.current !== undefined) clearTimeout(resetTimer.current)
    activeRowRef.current?.removeAttribute('data-json-copy-active')
  }, [])

  useEffect(() => {
    activeRowRef.current?.removeAttribute('data-json-copy-active')
    activeRowRef.current = undefined
    copyMenuOpenRef.current = false
    setCopyTarget(undefined)
    setCopyState('idle')
    setCopyMenuOpen(false)
    setTabStopId(initialTabStopId)
  }, [data, expandTopLevel, initialTabStopId])

  useEffect(() => {
    /** 中文说明：组件局部值 reposition，由紧邻初始化决定。 */
    const reposition = () => {
      /** 中文说明：组件局部值 row，由紧邻初始化决定。 */
      const row = activeRowRef.current
      if (row !== undefined) repositionCopyButton(row)
    }
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [])

  /** 中文说明：组件局部值 handleRowHover，由紧邻初始化决定。 */
  const handleRowHover = (row: HTMLElement, target: RowTarget) => {
    if (!copyable || copyMenuOpenRef.current) return
    if (activeRowRef.current === row) return
    setActiveRow(row)
    setCopyState('idle')
    copyMenuOpenRef.current = false
    setCopyMenuOpen(false)
    positionCopyButton(row, target)
  }

  /** 中文说明：组件局部值 handleRootMouseOver，由紧邻初始化决定。 */
  const handleRootMouseOver = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!copyable || copyMenuOpenRef.current) return
    /* v8 ignore next -- browser mouse events delivered through React target an Element. */
    if (!(event.target instanceof Element)) return
    if (event.target.closest('[data-json-copy-button]') === null) clearCopyTarget()
  }

  /** 中文说明：组件局部值 handleScroll，由紧邻初始化决定。 */
  const handleScroll = (_event: ReactUIEvent<HTMLDivElement>) => {
    /** 中文说明：组件局部值 row，由紧邻初始化决定。 */
    const row = activeRowRef.current
    if (row !== undefined) repositionCopyButton(row)
  }

  /** 中文说明：组件局部值 copy，由紧邻初始化决定。 */
  const copy = async (mode: 'json' | 'path' | 'prettyJson' | 'value') => {
    /* v8 ignore next -- copy controls only render while their target exists. */
    if (copyTarget === undefined) return
    try {
      await navigator.clipboard.writeText(copyText(copyTarget, mode))
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
    if (resetTimer.current !== undefined) clearTimeout(resetTimer.current)
    resetTimer.current = setTimeout(() => { setCopyState('idle') }, 1_500)
  }

  /** 中文说明：组件局部值 [rootOpen, rootClose]，由紧邻初始化决定。 */
  const [rootOpen, rootClose] = bracketOf(data)
  /** 中文说明：组件局部值 copyTargetIsObject，由紧邻初始化决定。 */
  const copyTargetIsObject = typeof copyTarget?.value === 'object' && copyTarget.value !== null
  /** 中文说明：组件局部值 defaultCopyMode，由紧邻初始化决定。 */
  const defaultCopyMode = copyTargetIsObject ? 'prettyJson' : 'value'
  /** 中文说明：组件局部值 copyTitle，由紧邻初始化决定。 */
  const copyTitle = copyState === 'copied'
    ? labels.copied
    : copyState === 'failed'
      ? labels.copyFailed
      : copyTargetIsObject ? labels.copyPrettyJson : labels.copyValue

  return (
    <div
      ref={rootRef}
      className={clsx(css.root, className)}
      onMouseOver={handleRootMouseOver}
      onMouseLeave={() => {
        if (!copyMenuOpenRef.current) clearCopyTarget()
      }}
      onScroll={handleScroll}
    >
      {expandTopLevel
        ? (
          <div className={css.expandedTopLevel}>
            <div
              className={clsx(css.row, css.topLevelBracket)}
              data-json-root-row
              onMouseOver={(event) => {
                event.stopPropagation()
                handleRowHover(event.currentTarget, { path: [], value: data })
              }}
            >
              <span className={css.punctuation}>{rootOpen}</span>
            </div>
            <div
              aria-label={label}
              className={clsx(css.container, css.expandedTopLevelContainer)}
              role="tree"
            >
              {rootEntries.map(([key, value], index) => (
                <JsonTreeNode
                  key={key}
                  field={key}
                  value={value}
                  path={[Array.isArray(data) ? index : key]}
                  labels={labels}
                  lastElement={index === rootEntries.length - 1}
                  initialExpanded={false}
                  tabStopId={tabStopId}
                  onClaimTabStop={setTabStopId}
                  onRowHover={handleRowHover}
                />
              ))}
            </div>
            <div className={clsx(css.row, css.topLevelBracket)}>
              <span className={css.punctuation}>{rootClose}</span>
            </div>
          </div>
        )
        : (
          <div aria-label={label} className={css.container} role="tree">
            <JsonTreeNode
              value={data}
              path={[]}
              labels={labels}
              lastElement
              initialExpanded
              tabStopId={tabStopId}
              onClaimTabStop={setTabStopId}
              onRowHover={handleRowHover}
            />
          </div>
        )}
      {copyTarget !== undefined && (
        <span
          className={css.copyAnchor}
          style={{ left: copyTarget.left, top: copyTarget.top }}
        >
          <Menu
            open={copyMenuOpen}
            compact
            portal
            align="end"
            side={copyTarget.side}
            anchor={(
              <button
                ref={copyButtonRef}
                type="button"
                className={css.copyButton}
                data-json-copy-button
                data-state={copyState}
                aria-label={copyTitle}
                title={labels.copyButtonTitle(copyTitle)}
                onClick={() => void copy(defaultCopyMode)}
                onContextMenu={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  copyMenuOpenRef.current = true
                  setCopyMenuOpen(true)
                }}
              >
                {copyState === 'copied'
                  ? <IconCheckOutline16 size={12} />
                  : <IconCopyOutline16 size={12} />}
              </button>
            )}
            items={copyTargetIsObject ? objectCopyMenuItems(labels) : valueCopyMenuItems(labels)}
            onSelect={(id) => {
              void copy(id as 'json' | 'path' | 'prettyJson' | 'value')
              copyMenuOpenRef.current = false
              setCopyMenuOpen(false)
            }}
            onClose={clearCopyTarget}
            getAnchorRect={() => (
              copyButtonRef.current as HTMLButtonElement
            ).getBoundingClientRect()}
          />
        </span>
      )}
    </div>
  )
}
