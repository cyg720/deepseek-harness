/**
 * 文件职责：把持久会话事件增量组装为客户端可渲染的对话、工具调用和运行状态。
 * 技术维度：TypeScript 判别联合、事件投影、不可变快照、Map 索引与严格穷尽检查。
 * 产品维度：为会话界面提供稳定的消息时间线、实时流式内容和工具执行展示。
 * 逻辑维度：按序接收事件，更新消息与调用索引，合并流式片段，最终生成对话快照。
 * 关键边界：输入事件必须按会话序号有序；未知必需事件不可静默忽略；投影状态不能泄漏可变引用。
 * 新手阅读建议：先读导出类型与状态结构，再看入口 reduce/append，最后按事件标签追踪各分支。
 */
import type {
  ConversationContextReader, ConversationEventInput, ConversationLocationData, ConversationMatch,
  ConversationNodeContext, ConversationNodeDefinition, ConversationPreviousContext,
  ConversationLocationDataScope, ConversationPublication, ConversationViewBuilder,
  ConversationViewDefinition, ConversationViewNode, ConversationViewSnapshotMap,
  ConversationViewSnapshotStore,
} from '../contract/conversation.ts'
import { conversationContextKey } from '../contract/conversation.ts'
import {
  ConversationLocationIndex, type ConversationLocationDataChange,
} from './conversation-location-index.ts'

/** 中文说明：类型 `Dependency` 约束本文件使用的数据字段和取值范围，避免调用方传入不完整状态。 */
interface Dependency {
  readonly kind: string
  readonly key: string | undefined
  readonly revision: number | undefined
  readonly windowGap: boolean
}

/** 中文说明：类型 `InternalContext` 约束本文件使用的数据字段和取值范围，避免调用方传入不完整状态。 */
interface InternalContext {
  readonly key: string
  readonly kind: string
  readonly id: string
  readonly definition: ConversationNodeDefinition
  startSeq: number | undefined
  start: ConversationMatch | undefined
  matches: ConversationMatch[]
  state: unknown
  revision: number
  readonly current: Map<string, ConversationViewNode | null>
  readonly locationData: Record<ConversationLocationDataScope, ConversationLocationData | null>
  dependencies: Map<string, Dependency>
}

/** 中文说明：类型 `PendingMatch` 约束本文件使用的数据字段和取值范围，避免调用方传入不完整状态。 */
interface PendingMatch {
  readonly definition: ConversationNodeDefinition
  readonly id: string
  readonly match: ConversationMatch
}

/** 中文说明：类型 `ViewState` 约束本文件使用的数据字段和取值范围，避免调用方传入不完整状态。 */
interface ViewState {
  readonly target: string
  readonly builder: ConversationViewBuilder
  snapshot: unknown
}

/** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `PUBLICATION_RANK` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
const PUBLICATION_RANK: Record<ConversationPublication, number> = {
  none: 0,
  'animation-frame': 1,
  immediate: 2,
}

/** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `LOCATION_DATA_SCOPES` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
const LOCATION_DATA_SCOPES: readonly ConversationLocationDataScope[] = ['step', 'turn']

/** 中文说明：内部函数 `emptyLocationData`；参数含义见签名，返回值用于后续处理；例如按本文件中的调用位置使用。 */
function emptyLocationData(): Record<ConversationLocationDataScope, ConversationLocationData | null> {
  return { step: null, turn: null }
}

/** 中文说明：内部函数 `maximumPublication`；参数含义见签名，返回值用于后续处理；例如按本文件中的调用位置使用。 */
function maximumPublication(
  left: ConversationPublication,
  right: ConversationPublication,
): ConversationPublication {
  return PUBLICATION_RANK[left] >= PUBLICATION_RANK[right] ? left : right
}

/** 中文说明：内部函数 `startSeq`；参数含义见签名，返回值用于后续处理；例如按本文件中的调用位置使用。 */
function startSeq(context: InternalContext): number | undefined {
  return context.startSeq
}

/** 中文说明：内部函数 `insertionIndex`；参数含义见签名，返回值用于后续处理；例如按本文件中的调用位置使用。 */
function insertionIndex(contexts: readonly InternalContext[], seq: number): number {
  /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `low` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  let low = 0
  /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `high` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  let high = contexts.length
  while (low < high) {
    /** 中文说明：标识对象、顺序或版本的标量值；变量 `middle` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const middle = low + Math.floor((high - low) / 2)
    /** 中文说明：标识对象、顺序或版本的标量值；变量 `candidate` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const candidate = contexts[middle]
    if (candidate !== undefined && (candidate.startSeq as number) < seq) low = middle + 1
    else high = middle
  }
  return low
}

/** 中文说明：内部函数 `contextSnapshot`；参数含义见签名，返回值用于后续处理；例如按本文件中的调用位置使用。 */
function contextSnapshot<State>(context: InternalContext): ConversationNodeContext<State> {
  return {
    key: context.key,
    kind: context.kind,
    id: context.id,
    matches: context.matches,
    start: context.start,
    state: context.state as State | undefined,
    current: context.current,
  }
}

/** 中文说明：内部函数 `mergeMatches`；参数含义见签名，返回值用于后续处理；例如按本文件中的调用位置使用。 */
function mergeMatches(
  key: string,
  additions: readonly ConversationMatch[],
  existing: readonly ConversationMatch[],
): ConversationMatch[] {
  /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `merged` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const merged: ConversationMatch[] = []
  /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `added` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  let added = 0
  /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `current` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  let current = 0
  while (added < additions.length || current < existing.length) {
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `left` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const left = additions[added]
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `right` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const right = existing[current]
    if (left !== undefined && right !== undefined && left.event.seq === right.event.seq) {
      throw new Error(`conversation Context ${key} received duplicate Match ${left.event.seq}`)
    }
    if (right === undefined || (left !== undefined && left.event.seq < right.event.seq)) {
      merged.push(left as ConversationMatch)
      added++
    } else {
      merged.push(right)
      current++
    }
  }
  return merged
}

/** Event Registry subset consumed by a Session-owned Assembler. */
/** 中文说明：类型 `ConversationEventDefinitions` 约束本文件使用的数据字段和取值范围，避免调用方传入不完整状态。 */
export interface ConversationEventDefinitions {
  /** @returns ordinary Definitions in registration order. */
  entries(): readonly ConversationNodeDefinition[]
  /** @returns unmatched-event fallback, when registered. */
  fallbackEntry(): ConversationNodeDefinition | undefined
}

/** View Registry subset consumed by a Session-owned Assembler. */
/** 中文说明：类型 `ConversationViewDefinitions` 约束本文件使用的数据字段和取值范围，避免调用方传入不完整状态。 */
export interface ConversationViewDefinitions {
  /** @returns view builder factories in registration order. */
  entries(): readonly ConversationViewDefinition[]
}

/**
 * Session-owned incremental engine that assembles business Contexts from a
 * contiguous Event window and materializes registered view snapshots.
 */
/** 中文说明：类 `ConversationNodeAssembler` 负责封装本文件的核心状态与操作，实例由调用方创建并按生命周期释放。 */
export class ConversationNodeAssembler implements ConversationViewSnapshotStore {
  /** 中文说明：类方法 `contexts`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private readonly contexts = new Map<string, InternalContext>()
  /** 中文说明：类方法 `contextsByKind`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private readonly contextsByKind = new Map<string, InternalContext[]>()
  /** 中文说明：类方法 `contextsBySeq`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private readonly contextsBySeq = new Map<number, Set<InternalContext>>()
  /** 中文说明：类方法 `inputs`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private readonly inputs = new Map<number, ConversationEventInput>()
  /** 中文说明：类方法 `locationIndex`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private readonly locationIndex = new ConversationLocationIndex()
  /** 中文说明：类方法 `dirty`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private readonly dirty = new Set<InternalContext>()
  /** 中文说明：类方法 `revised`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private readonly revised = new Set<InternalContext>()
  /** 中文说明：类方法 `dependents`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private readonly dependents = new Map<string, Set<InternalContext>>()
  /** 中文说明：类方法 `views`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private readonly views = new Map<string, ViewState>()
  /** 中文说明：类成员 `hasMore` 保存该实例拥有的运行状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  private hasMore = false
  /** 中文说明：类成员 `replacePending` 保存该实例拥有的运行状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  private replacePending = true
  /** 中文说明：类成员 `timelineDirty` 保存该实例拥有的运行状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  private timelineDirty = true

  /**
   * @param eventDefinitions - live Event Definition registry.
   * @param viewDefinitions - live view builder registry.
   */
  /** 中文说明：类方法 `constructor`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  constructor(
    private readonly eventDefinitions: ConversationEventDefinitions,
    private readonly viewDefinitions: ConversationViewDefinitions,
  ) {
    this.resetViewBuilders()
  }

  /**
   * Replace the complete loaded window after open, resync, or gap repair.
   * @param entries - complete contiguous window.
   * @param hasMore - whether older history remains outside the window.
   * @returns immediate publication request.
   */
  /** 中文说明：类方法 `replaceWindow`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  replaceWindow(entries: readonly ConversationEventInput[], hasMore: boolean): ConversationPublication {
    this.contexts.clear()
    this.contextsByKind.clear()
    this.contextsBySeq.clear()
    this.inputs.clear()
    this.dirty.clear()
    this.revised.clear()
    this.dependents.clear()
    this.hasMore = hasMore
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `sorted` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
    const sorted = [...entries].sort((left, right) => left.event.seq - right.event.seq)
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `entry` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const entry of sorted) this.inputs.set(entry.event.seq, entry)
    this.locationIndex.rebuild(sorted)
    this.timelineDirty = true
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `entry` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const entry of sorted) this.matchInput(entry)
    this.replayDependencies()
    this.revised.clear()
    /** 中文说明：当前操作所属的 Cordis 上下文；变量 `context` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const context of this.contexts.values()) this.dirty.add(context)
    this.replacePending = true
    return 'immediate'
  }

  /**
   * Add one contiguous live tail event without scanning existing Contexts.
   * @param input - appended Event and optional wire view.
   * @returns highest requested publication cadence.
   */
  /** 中文说明：类方法 `append`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  append(input: ConversationEventInput): ConversationPublication {
    if (this.inputs.has(input.event.seq)) return 'none'
    this.revised.clear()
    this.inputs.set(input.event.seq, input)
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `publication` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let publication: ConversationPublication = 'none'
    if (isLocationBoundary(input.event.type)) {
      /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `previousTimeline` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const previousTimeline = this.locationIndex.snapshot()
      /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `changed` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const changed = this.locationIndex.appendBoundary(input.event)
      if (this.locationIndex.snapshot() !== previousTimeline) {
        this.timelineDirty = true
        publication = 'immediate'
      }
      this.replayContexts(this.refreshMatchLocations(changed))
      if (changed.size > 0) publication = 'immediate'
    } else {
      this.locationIndex.appendNonBoundary(input.event)
    }
    publication = maximumPublication(publication, this.matchInput(input))
    if (this.replayRevisedDependents()) publication = 'immediate'
    this.revised.clear()
    return publication
  }

  /**
   * Add an older page while preserving existing Context and view identities.
   * @param entries - newly loaded older Events.
   * @param hasMore - whether history still precedes the expanded window.
   * @returns highest requested publication cadence.
   */
  /** 中文说明：类方法 `prepend`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  prepend(entries: readonly ConversationEventInput[], hasMore: boolean): ConversationPublication {
    this.revised.clear()
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `publication` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let publication: ConversationPublication = 'none'
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `previousHasMore` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const previousHasMore = this.hasMore
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `fresh` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const fresh = entries
      .filter(entry => !this.inputs.has(entry.event.seq))
      .sort((left, right) => left.event.seq - right.event.seq)
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `entry` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const entry of fresh) this.inputs.set(entry.event.seq, entry)
    this.hasMore = hasMore
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `previousTimeline` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const previousTimeline = this.locationIndex.snapshot()
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `changedLocations` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const changedLocations = this.locationIndex.rebuild(this.sortedInputs())
    if (this.locationIndex.snapshot() !== previousTimeline) this.timelineDirty = true
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `affected` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const affected = this.refreshMatchLocations(changedLocations)
    /** 中文说明：协调异步执行顺序或保存待完成工作的 Promise；变量 `pending` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const pending = new Map<string, PendingMatch[]>()
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `entry` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const entry of fresh) {
      publication = maximumPublication(publication, this.collectInput(entry, pending))
    }
    this.applyPendingMatches(pending, affected)
    this.replayContexts(affected)
    if ((this.revised.size > 0 || previousHasMore !== hasMore) && this.replayDependencies()) {
      publication = 'immediate'
    }
    if (changedLocations.size > 0) publication = 'immediate'
    this.revised.clear()
    return publication
  }

  /**
   * Rebuild against the current Registry set after a low-frequency plugin change.
   * @returns immediate publication request.
   */
  /** 中文说明：类方法 `rebuildRegistry`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  rebuildRegistry(): ConversationPublication {
    this.resetViewBuilders()
    return this.replaceWindow(this.sortedInputs(), this.hasMore)
  }

  /**
   * Materialize dirty Contexts and advance every registered view builder.
   * @returns whether any view snapshot was rebuilt or incrementally applied.
   */
  /** 中文说明：类方法 `flush`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  flush(): boolean {
    if (!this.replacePending && this.dirty.size === 0 && !this.timelineDirty) return false
    if (this.replacePending) {
      this.replaceLocationData()
      /** 中文说明：保存索引、集合或按顺序观测值的数据结构；变量 `allByTarget` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const allByTarget = new Map<string, ConversationViewNode[]>()
      /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `target` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      for (const target of this.views.keys()) allByTarget.set(target, [])
      /** 中文说明：当前操作所属的 Cordis 上下文；变量 `context` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      for (const context of this.contexts.values()) {
        /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `target` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
        const target = context.definition.target
        if (target === undefined || !this.views.has(target)) continue
        /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `node` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
        const node = this.buildNode(context, target)
        context.current.set(target, node)
        if (node !== null) allByTarget.get(target)?.push(node)
      }
      /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `view` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      for (const view of this.views.values()) {
        view.snapshot = view.builder.replace({
          nodes: allByTarget.get(view.target) ?? [],
          timeline: this.locationIndex.snapshot(),
        })
      }
      this.replacePending = false
      this.dirty.clear()
      this.timelineDirty = false
      return true
    }

    /** 中文说明：保存索引、集合或按顺序观测值的数据结构；变量 `upsertsByTarget` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const upsertsByTarget = new Map<string, ConversationViewNode[]>()
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `target` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const target of this.views.keys()) upsertsByTarget.set(target, [])
    if (this.applyDirtyLocationData()) this.timelineDirty = true
    /** 中文说明：当前操作所属的 Cordis 上下文；变量 `context` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const context of this.dirty) {
      /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `target` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const target = context.definition.target
      if (target === undefined || !this.views.has(target)) continue
      /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `previous` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const previous = context.current.get(target) ?? null
      /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `node` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const node = this.buildNode(context, target)
      if (node === null && previous !== null) {
        throw new Error(
          `conversation Definition "${context.kind}" withdrew materialized target "${target}"; return the same key with hidden visibility instead`,
        )
      }
      context.current.set(target, node)
      if (node !== null) upsertsByTarget.get(target)?.push(node)
    }
    this.dirty.clear()
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `timelineDirty` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const timelineDirty = this.timelineDirty
    this.timelineDirty = false
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `view` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const view of this.views.values()) {
      /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `upserts` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const upserts = upsertsByTarget.get(view.target) ?? []
      if (upserts.length === 0 && !timelineDirty) continue
      view.snapshot = view.builder.apply({
        upserts,
        timeline: this.locationIndex.snapshot(),
      })
    }
    return true
  }

  /**
   * Read the latest snapshot of a registered target.
   * @param target - registered view target.
   * @returns target snapshot, or undefined when no builder is registered.
   */
  /** 中文说明：类方法 `snapshot`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  snapshot(target: string): unknown {
    return this.views.get(target)?.snapshot
  }

  get<Target extends Extract<keyof ConversationViewSnapshotMap, string>>(
    target: Target,
  ): ConversationViewSnapshotMap[Target] | undefined {
    return this.snapshot(target) as ConversationViewSnapshotMap[Target] | undefined
  }

  /** 中文说明：类方法 `sortedInputs`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private sortedInputs(): ConversationEventInput[] {
    return [...this.inputs.values()].sort((left, right) => left.event.seq - right.event.seq)
  }

  /** 中文说明：类方法 `matchInput`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private matchInput(input: ConversationEventInput): ConversationPublication {
    return this.dispatchInput(input, (definition, id, role) =>
      this.acceptMatch(definition, id, role, input))
  }

  /** 中文说明：类方法 `collectInput`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private collectInput(
    input: ConversationEventInput,
    pending: Map<string, PendingMatch[]>,
  ): ConversationPublication {
    return this.dispatchInput(input, (definition, id, role) => {
      /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `key` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const key = conversationContextKey(definition.kind, id)
      /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `match` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const match: ConversationMatch = {
        ...input,
        role,
        location: this.locationIndex.locationOf(input.event),
      }
      /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `matches` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const matches = pending.get(key) ?? []
      matches.push({ definition, id, match })
      pending.set(key, matches)
      return definition.publication?.(match) ?? 'immediate'
    })
  }

  /** 中文说明：类方法 `dispatchInput`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private dispatchInput(
    input: ConversationEventInput,
    accept: (
      definition: ConversationNodeDefinition,
      id: string,
      role: ConversationMatch['role'],
    ) => ConversationPublication,
  ): ConversationPublication {
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `matchedTargets` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const matchedTargets = new Set<string>()
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `publication` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let publication: ConversationPublication = 'none'
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `definition` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const definition of this.eventDefinitions.entries()) {
      /** 中文说明：当前异步操作的请求或结果；变量 `result` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const result = definition.match(input.event)
      if (result === null) continue
      if (definition.target !== undefined) matchedTargets.add(definition.target)
      publication = maximumPublication(publication, accept(definition, result.id, result.role))
    }
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `fallback` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const fallback = this.eventDefinitions.fallbackEntry()
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `target` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const target = fallback?.target
    if (fallback !== undefined && target !== undefined && !matchedTargets.has(target)) {
      /** 中文说明：当前异步操作的请求或结果；变量 `result` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const result = fallback.match(input.event)
      if (result !== null) {
        publication = maximumPublication(publication, accept(fallback, result.id, result.role))
      }
    }
    return publication
  }

  /** 中文说明：类方法 `acceptMatch`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private acceptMatch(
    definition: ConversationNodeDefinition,
    id: string,
    role: ConversationMatch['role'],
    input: ConversationEventInput,
  ): ConversationPublication {
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `key` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const key = conversationContextKey(definition.kind, id)
    /** 中文说明：当前操作所属的 Cordis 上下文；变量 `context` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let context = this.contexts.get(key)
    if (role === 'start' && context?.start !== undefined) {
      throw new Error(`conversation Context ${key} received more than one start Match`)
    }
    if (context === undefined) {
      context = {
        key,
        kind: definition.kind,
        id,
        definition,
        startSeq: undefined,
        start: undefined,
        matches: [],
        state: undefined,
        revision: 0,
        current: new Map(),
        locationData: emptyLocationData(),
        dependencies: new Map(),
      }
      this.contexts.set(key, context)
    }
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `match` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const match: ConversationMatch = {
      ...input,
      role,
      location: this.locationIndex.locationOf(input.event),
    }
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `previous` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const previous = context.matches.at(-1)
    if (previous !== undefined && previous.event.seq >= input.event.seq) {
      throw new Error(`conversation Context ${key} received non-appended Match ${input.event.seq}`)
    }
    if (role === 'start' && context.matches.length > 0) {
      throw new Error(`conversation Context ${key} received an update before its start Match`)
    }
    context.matches.push(match)
    if (role === 'start') {
      context.startSeq = input.event.seq
      context.start = match
      this.indexStartedContext(context)
    }
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `owners` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const owners = this.contextsBySeq.get(input.event.seq) ?? new Set<InternalContext>()
    owners.add(context)
    this.contextsBySeq.set(input.event.seq, owners)

    if (role === 'start') {
      this.replayContext(context)
    } else if (context.state !== undefined) {
      /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `typed` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const typed = contextSnapshot(context) as ConversationNodeContext & { readonly state: unknown }
      context.state = requireState(definition, 'update', definition.update(typed, match))
      context.revision++
      this.revised.add(context)
    }
    this.dirty.add(context)
    return definition.publication?.(match) ?? 'immediate'
  }

  /** 中文说明：类方法 `applyPendingMatches`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private applyPendingMatches(
    pending: ReadonlyMap<string, readonly PendingMatch[]>,
    affected: Set<InternalContext>,
  ): void {
    /** 中文说明：保存索引、集合或按顺序观测值的数据结构；变量 `startsByKind` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const startsByKind = new Map<string, InternalContext[]>()
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `[key` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const [key, entries] of pending) {
      /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `first` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const first = entries[0]
      if (first === undefined) continue
      /** 中文说明：当前操作所属的 Cordis 上下文；变量 `context` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      let context = this.contexts.get(key)
      if (context === undefined) {
        context = {
          key,
          kind: first.definition.kind,
          id: first.id,
          definition: first.definition,
          startSeq: undefined,
          start: undefined,
          matches: [],
          state: undefined,
          revision: 0,
          current: new Map(),
          locationData: emptyLocationData(),
          dependencies: new Map(),
        }
        this.contexts.set(key, context)
      }
      /** 中文说明：当前会话或对话投影对象；变量 `discoveredStart: ConversationMatch | undefined` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      let discoveredStart: ConversationMatch | undefined
      /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `additions` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const additions = entries
        .map((entry) => {
          if (entry.definition !== context.definition || entry.id !== context.id) {
            throw new Error(`conversation Context ${key} received inconsistent Definition identity`)
          }
          if (entry.match.role === 'start') {
            if (discoveredStart !== undefined || context.start !== undefined) {
              throw new Error(`conversation Context ${key} received more than one start Match`)
            }
            discoveredStart = entry.match
          }
          /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `owners` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
          const owners = this.contextsBySeq.get(entry.match.event.seq) ?? new Set<InternalContext>()
          owners.add(context)
          this.contextsBySeq.set(entry.match.event.seq, owners)
          return entry.match
        })
        .sort((left, right) => left.event.seq - right.event.seq)
      context.matches = mergeMatches(context.key, additions, context.matches)
      if (discoveredStart !== undefined) {
        context.start = discoveredStart
        context.startSeq = discoveredStart.event.seq
        /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `starts` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
        const starts = startsByKind.get(context.kind) ?? []
        starts.push(context)
        startsByKind.set(context.kind, starts)
      }
      if (context.start !== undefined && context.matches[0] !== context.start) {
        throw new Error(`conversation Context ${context.key} received an update before its start Match`)
      }
      affected.add(context)
      this.dirty.add(context)
    }
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `[kind` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const [kind, contexts] of startsByKind) this.indexStartedContexts(kind, contexts)
  }

  /** 中文说明：类方法 `replayContexts`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private replayContexts(contexts: ReadonlySet<InternalContext>): void {
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `ordered` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
    const ordered = [...contexts].sort((left, right) =>
      (left.startSeq ?? Number.POSITIVE_INFINITY) - (right.startSeq ?? Number.POSITIVE_INFINITY))
    /** 中文说明：当前操作所属的 Cordis 上下文；变量 `context` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const context of ordered) {
      if (context.start === undefined) {
        context.state = undefined
        this.dirty.add(context)
        continue
      }
      this.replayContext(context)
    }
  }

  /** 中文说明：类方法 `replayContext`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private replayContext(context: InternalContext): void {
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `start` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const start = context.start
    if (start === undefined) {
      context.state = undefined
      return
    }
    if (context.matches[0] !== start) {
      throw new Error(`conversation Context ${context.key} received an update before its start Match`)
    }
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `dependencies` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const dependencies = new Map<string, Dependency>()
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `reader` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const reader = this.readerFor(start.event.seq, dependencies)
    context.state = undefined
    context.state = requireState(
      context.definition,
      'start',
      context.definition.start(contextSnapshot(context), start, reader),
    )
    this.replaceDependencies(context, dependencies)
    /** 中文说明：保存索引、集合或按顺序观测值的数据结构；变量 `index` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (let index = 1; index < context.matches.length; index++) {
      /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `match` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const match = context.matches[index]
      if (match === undefined || match.role !== 'update') continue
      /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `typed` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const typed = contextSnapshot(context) as ConversationNodeContext & { readonly state: unknown }
      context.state = requireState(
        context.definition,
        'update',
        context.definition.update(typed, match),
      )
    }
    context.revision++
    this.revised.add(context)
    this.dirty.add(context)
  }

  /** 中文说明：类方法 `replaceDependencies`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private replaceDependencies(context: InternalContext, dependencies: Map<string, Dependency>): void {
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `dependency` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const dependency of context.dependencies.values()) {
      if (dependency.key === undefined) continue
      /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `current` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const current = this.dependents.get(dependency.key)
      current?.delete(context)
      if (current?.size === 0) this.dependents.delete(dependency.key)
    }
    context.dependencies = dependencies
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `dependency` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const dependency of dependencies.values()) {
      if (dependency.key === undefined) continue
      /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `current` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const current = this.dependents.get(dependency.key) ?? new Set()
      current.add(context)
      this.dependents.set(dependency.key, current)
    }
  }

  /** 中文说明：类方法 `replayRevisedDependents`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private replayRevisedDependents(): boolean {
    /** 中文说明：协调异步执行顺序或保存待完成工作的 Promise；变量 `pending` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const pending = [...this.revised]
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `affected` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const affected = new Set<InternalContext>()
    /** 中文说明：保存索引、集合或按顺序观测值的数据结构；变量 `index` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (let index = 0; index < pending.length; index++) {
      /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `dependency` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const dependency = pending[index]
      if (dependency === undefined) continue
      /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `dependent` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      for (const dependent of this.dependents.get(dependency.key) ?? []) {
        if (affected.has(dependent)) continue
        affected.add(dependent)
        pending.push(dependent)
      }
    }
    this.replayContexts(affected)
    return affected.size > 0
  }

  /** 中文说明：类方法 `readerFor`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private readerFor(
    beforeSeq: number,
    dependencies: Map<string, Dependency>,
  ): ConversationContextReader {
    return {
      previous: <State>(kind: string): ConversationPreviousContext<State> | undefined => {
        /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `predecessor` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
        const predecessor = this.previousContext(kind, beforeSeq)
        dependencies.set(kind, {
          kind,
          key: predecessor?.key,
          revision: predecessor?.revision,
          windowGap: predecessor === undefined && this.hasMore,
        })
        if (predecessor?.state === undefined) return undefined
        /** 中文说明：标识对象、顺序或版本的标量值；变量 `seq` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
        const seq = startSeq(predecessor)
        if (seq === undefined) return undefined
        return {
          key: predecessor.key,
          kind: predecessor.kind,
          id: predecessor.id,
          startSeq: seq,
          state: predecessor.state as Readonly<State>,
          matches: predecessor.matches,
        }
      },
    }
  }

  /** 中文说明：类方法 `previousContext`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private previousContext(kind: string, beforeSeq: number): InternalContext | undefined {
    /** 中文说明：标识对象、顺序或版本的标量值；变量 `candidates` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const candidates = this.contextsByKind.get(kind) ?? []
    /** 中文说明：保存索引、集合或按顺序观测值的数据结构；变量 `indexBefore` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const indexBefore = insertionIndex(candidates, beforeSeq)
    /** 中文说明：保存索引、集合或按顺序观测值的数据结构；变量 `index` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (let index = indexBefore - 1; index >= 0; index--) {
      /** 中文说明：标识对象、顺序或版本的标量值；变量 `candidate` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const candidate = candidates[index]
      if (candidate?.state !== undefined) return candidate
    }
    return undefined
  }

  /** Insert one newly discovered start into its Definition's ordered predecessor index. */
  /** 中文说明：类方法 `indexStartedContext`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private indexStartedContext(context: InternalContext): void {
    /** 中文说明：标识对象、顺序或版本的标量值；变量 `seq` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const seq = context.startSeq
    if (seq === undefined) return
    /** 中文说明：标识对象、顺序或版本的标量值；变量 `candidates` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const candidates = this.contextsByKind.get(context.kind) ?? []
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `previous` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const previous = candidates.at(-1)
    if (previous === undefined || (previous.startSeq as number) < seq) candidates.push(context)
    else candidates.splice(insertionIndex(candidates, seq), 0, context)
    this.contextsByKind.set(context.kind, candidates)
  }

  /** 中文说明：类方法 `indexStartedContexts`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private indexStartedContexts(kind: string, additions: readonly InternalContext[]): void {
    if (additions.length === 0) return
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `sorted` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
    const sorted = [...additions].sort((left, right) =>
      (left.startSeq as number) - (right.startSeq as number))
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `existing` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const existing = this.contextsByKind.get(kind) ?? []
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `merged` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const merged: InternalContext[] = []
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `before` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let before = 0
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `added` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let added = 0
    while (before < existing.length || added < sorted.length) {
      /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `left` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const left = existing[before]
      /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `right` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const right = sorted[added]
      if (right === undefined || (left !== undefined && (left.startSeq as number) < (right.startSeq as number))) {
        merged.push(left as InternalContext)
        before++
      } else {
        merged.push(right)
        added++
      }
    }
    this.contextsByKind.set(kind, merged)
  }

  /** 中文说明：类方法 `replayDependencies`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private replayDependencies(): boolean {
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `replayed` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let replayed = false
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `ordered` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const ordered = [...this.contexts.values()]
      .filter(context => startSeq(context) !== undefined)
      .sort((left, right) => (startSeq(left) as number) - (startSeq(right) as number))
    /** 中文说明：当前操作所属的 Cordis 上下文；变量 `context` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const context of ordered) {
      if (context.state === undefined || context.dependencies.size === 0) continue
      /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `before` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const before = startSeq(context)
      if (before === undefined) continue
      /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `changed` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      let changed = false
      /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `dependency` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      for (const dependency of context.dependencies.values()) {
        /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `current` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
        const current = this.previousContext(dependency.kind, before)
        /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `windowGap` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
        const windowGap = current === undefined && this.hasMore
        if (current?.key !== dependency.key
          || current?.revision !== dependency.revision
          || windowGap !== dependency.windowGap) {
          changed = true
          break
        }
      }
      if (changed) {
        this.replayContext(context)
        replayed = true
      }
    }
    return replayed
  }

  /** 中文说明：类方法 `refreshMatchLocations`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private refreshMatchLocations(changedSeqs: ReadonlySet<number>): Set<InternalContext> {
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `affected` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const affected = new Set<InternalContext>()
    if (changedSeqs.size === 0) return affected
    /** 中文说明：标识对象、顺序或版本的标量值；变量 `seq` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const seq of changedSeqs) {
      /** 中文说明：当前操作所属的 Cordis 上下文；变量 `context` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      for (const context of this.contextsBySeq.get(seq) ?? []) affected.add(context)
    }
    /** 中文说明：当前操作所属的 Cordis 上下文；变量 `context` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const context of affected) {
      /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `start` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      let start = context.start
      /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `matches` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
      const matches = context.matches.map((match): ConversationMatch => {
        if (!changedSeqs.has(match.event.seq)) return match
        /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `refreshed` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
        const refreshed = { ...match, location: this.locationIndex.locationOf(match.event) }
        if (match === start) start = refreshed
        return refreshed
      })
      context.matches = matches
      context.start = start
    }
    return affected
  }

  /** 中文说明：类方法 `buildNode`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private buildNode(context: InternalContext, target: string): ConversationViewNode | null {
    if (context.definition.target !== target || context.definition.buildViewNode === undefined) return null
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `node` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const node = context.definition.buildViewNode(contextSnapshot(context))
    if (node === null) return null
    if (node.key !== context.key) {
      throw new Error(`conversation Definition "${context.kind}" returned unstable key "${node.key}"; expected "${context.key}"`)
    }
    if (node.target !== target) {
      throw new Error(`conversation Definition "${context.kind}" returned target "${node.target}" while building "${target}"`)
    }
    return node
  }

  /** 中文说明：类方法 `buildLocationData`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private buildLocationData(
    context: InternalContext,
    scope: ConversationLocationDataScope,
  ): ConversationLocationData | null {
    if (context.definition.buildLocationData === undefined) return null
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `data` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const data = context.definition.buildLocationData(contextSnapshot(context), scope)
    if (data === null) return null
    if (data.kind !== scope) {
      throw new Error(
        `conversation Definition "${context.kind}" published ${data.kind} data through its ${scope} scope`,
      )
    }
    if (data.key !== context.kind) {
      throw new Error(
        `conversation Definition "${context.kind}" published Location data key "${data.key}"; expected its owned kind`,
      )
    }
    if (!Number.isSafeInteger(data.turn) || data.turn < 0) {
      throw new Error(`conversation Definition "${context.kind}" published invalid turn ${data.turn}`)
    }
    if (data.kind === 'step' && (!Number.isSafeInteger(data.step) || (data.step as number) < 0)) {
      throw new Error(`conversation Definition "${context.kind}" published invalid step ${String(data.step)}`)
    }
    return data
  }

  /** 中文说明：类方法 `replaceLocationData`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private replaceLocationData(): void {
    /** 中文说明：保存索引、集合或按顺序观测值的数据结构；变量 `entries` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const entries: { owner: string; data: ConversationLocationData }[] = []
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `scope` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const scope of LOCATION_DATA_SCOPES) {
      /** 中文说明：当前操作所属的 Cordis 上下文；变量 `context` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      for (const context of this.contexts.values()) {
        /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `data` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
        const data = this.buildLocationData(context, scope)
        context.locationData[scope] = data
        if (data !== null) entries.push({ owner: context.key, data })
      }
      // Turn publishers may read Step data from this same flush, so each phase
      // installs the cumulative replacement before the next phase builds.
      this.locationIndex.replaceData(entries)
    }
  }

  /** 中文说明：类方法 `applyDirtyLocationData`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private applyDirtyLocationData(): boolean {
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `changed` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let changed = false
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `scope` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const scope of LOCATION_DATA_SCOPES) {
      /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `changes` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const changes: ConversationLocationDataChange[] = []
      /** 中文说明：当前操作所属的 Cordis 上下文；变量 `context` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      for (const context of this.dirty) {
        /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `previous` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
        const previous = context.locationData[scope]
        /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `next` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
        const next = this.buildLocationData(context, scope)
        context.locationData[scope] = next
        if (previous !== next) changes.push({ owner: context.key, previous, next })
      }
      changed = this.locationIndex.applyData(changes) || changed
    }
    return changed
  }

  /** 中文说明：类方法 `resetViewBuilders`；参数含义见签名，返回值用于更新或读取会话状态；例如由本类公开流程或下方用例调用。 */
  private resetViewBuilders(): void {
    this.views.clear()
    /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `definition` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const definition of this.viewDefinitions.entries()) {
      /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `builder` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const builder = definition.create()
      this.views.set(definition.target, {
        target: definition.target,
        builder,
        snapshot: builder.empty,
      })
    }
    this.replacePending = true
  }
}

/** 中文说明：内部函数 `isLocationBoundary`；参数含义见签名，返回值用于后续处理；例如按本文件中的调用位置使用。 */
function isLocationBoundary(type: string): boolean {
  return type === 'turn/start' || type === 'turn/end' || type === 'step/start' || type === 'step/end'
}

/** 中文说明：内部函数 `requireState`；参数含义见签名，返回值用于后续处理；例如按本文件中的调用位置使用。 */
function requireState(
  definition: ConversationNodeDefinition,
  phase: 'start' | 'update',
  state: unknown,
): unknown {
  if (state === undefined) {
    throw new Error(`conversation Definition "${definition.kind}" returned undefined from ${phase}()`)
  }
  return state
}

/** Structural registry pair accepted by Session and SessionManager. */
/** 中文说明：类型 `ConversationRuntime` 约束本文件使用的数据字段和取值范围，避免调用方传入不完整状态。 */
export interface ConversationRuntime {
  readonly events: ConversationEventDefinitions & { subscribe(listener: () => void): () => void }
  readonly views: ConversationViewDefinitions & { subscribe(listener: () => void): () => void }
}
