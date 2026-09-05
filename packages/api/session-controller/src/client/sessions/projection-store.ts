
/**
 * Generic per-session projection value store (push model; see the
 * session-projection subsystem page, docs/subsystems/session-projection.md):
 * the host is the only computation site; the client holds finished
 * whole values per key — `key → { value, seq }` — seeded by a follow opening
 * baseline and updated by Session Controller `projection` frames,
 * under the single rule **higher seq wins**. No client-side domain folding
 * exists: a domain ships projection support with zero client code. Per-key
 * bare observable faces feed `useProjection` (ui-renderer binds them).
 */
/*
 * 通用的按会话投影值存储（推送模型；见 docs/subsystems/session-projection.md）：
 * Host 是唯一计算点；客户端按键持有完整的最终值——key -> { value, seq }——
 * 由历史尾部页的 projections 块播种，由 session/projection 推送帧更新，
 * 遵循单一规则"seq 更大者胜"。不存在客户端侧域折叠：域以零客户端代码
 * 交付投影支持。每键裸可观察面供 useProjection 消费（ui-renderer 绑定）。
 */

/*
 * 【文件职责】保存主机计算完成的投影值；
 * 同一键只接受更新的序号，客户端不重复执行领域投影。
 */

import type { SessionProjectionMap } from '@deepseek-ai/dsh-session-projection/types'
import type { SessionSeqCursor } from '@deepseek-ai/dsh-session/types'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { Notifier } from './notifier.ts'

// The single projection type table, typed end to end (host unit, wire block,
// client store, React hook) — the Service Definition package's pure-type outlet
// (`/types`, zero imports), never the package root: the root's dsh-agent →
// dsh-session chain would drag the host `Context.sessions` merge into the
// client program (one program must not hold both sides). No second
// client-side "views" table (rejected in the Alternatives of
// .agents/notes/proposed/architecture/2026-07-27-session-projection-and-command-log.md).
// 唯一的投影类型表，端到端类型化（Host 单位、wire 块、客户端存储、React
// 钩子）——来自 Service Definition 包的纯类型出口（/types，零导入），绝
// 不是包根：包根的 dsh-agent -> dsh-session 链会把 Host 的 Context.sessions
// 合并拖进客户端程序（一个程序不能同时持有两侧）。也没有第二张客户端
// "视图"表（在 2026-07-27 笔记的 Alternatives 中被否决）。
export type { SessionProjectionMap } from '@deepseek-ai/dsh-session-projection/types'

/**
 * The fifth framework hook seat (see the session-projection subsystem page,
 * docs/subsystems/session-projection.md): key-addressed
 * projection reader delivered through the standard kit. `undefined` uniformly
 * means capability absent — host unit unmounted, or no baseline/frame has
 * carried the key yet. The selector overload mirrors useSession (per-key uSES
 * binding; reference stability holds because a key's value reference changes
 * only when a frame or baseline lands).
 */
/*
 * 第五个框架钩子座位（见 docs/subsystems/session-projection.md）：通过标准
 * 套件交付的按键寻址投影读取器。undefined 统一表示"能力缺失"——Host 单位
 * 未挂载，或尚无基线/帧携带该键。选择器重载镜像 useSession（按键 uSES
 * 绑定；引用稳定成立，因为一个键的值引用只在帧或基线落地时变化）。
 */
export type UseProjection = {
  <K extends Extract<keyof SessionProjectionMap, string>>(key: K): SessionProjectionMap[K] | undefined
  <K extends Extract<keyof SessionProjectionMap, string>, S>(
    key: K,
    selector: (value: SessionProjectionMap[K] | undefined) => S,
    eq?: (a: S, b: S) => boolean,
  ): S
}

/**
 * Follow-opening projection baseline, restated here so the
 * React-free store depends only on the type table, not the wire package's
 * response vocabulary.
 */
/*
 * 尾部页的投影基线——与线上的 SessionProjectionsBlock（apiproxy api 层）
 * 结构一致，在这里重述，使无 React 的存储只依赖类型表，而不依赖 wire
 * 包的响应词汇表。
 */
export interface ProjectionsBaseline {
  /** The consistent-cut seq (equals the window tail seq by construction). */
  asOfSeq: SessionSeqCursor
  /** Whole current values by key; a registered key absent here means the capability is absent. */
  values: Readonly<Record<string, unknown>>
}

/** One key's row: the latest finished value and the seq it is consistent with. */
/* 一个键的行：最新完整值及其一致的 seq。 */
interface Row {
  value: unknown
  seq: SessionSeqCursor
}

/** Per-key notification channel: the bare face plus its batching notifier. */
/* 每键通知通道：裸面 + 其批处理通知器。 */
interface Channel {
  face: ObservableSnapshot<unknown>
  notifier: Notifier
}

/**
 * One session's projection values. Framework semantics, uniform across every
 * key: a baseline seeds rows at its cut, a push frame updates one row, and in
 * both paths a lower-or-equal seq loses — a replayed frame cannot regress a
 * value, a stale baseline cannot overwrite a newer frame. A key the store has
 * never seen reads `undefined` (capability absent). Faces are identity-stable
 * per key (create-on-demand, cached) so the React side binds each exactly
 * once; the store-level channel (`subscribeAny`) serves coarse consumers (the
 * manager's list projection reads the `title` key).
 */
/*
 * 一个会话的投影值。框架语义对每个键一致：基线在其切割处播种行，推送帧
 * 更新一行，两条路径中"小于等于的 seq 输"——重放帧不能回退值，陈旧基线
 * 不能覆盖新帧。存储从未见过的键读作 undefined（能力缺失）。面按键身份
 * 稳定（按需创建并缓存），React 侧对每个键恰好绑定一次；存储级通道
 * （subscribeAny）服务粗粒度消费方（管理器的列表投影读取 title 键）。
 */
export class ProjectionValueStore {
  private readonly rows = new Map<string, Row>() // 键 -> 行的存储
  private readonly channels = new Map<string, Channel>() // 键 -> 通知通道缓存
  private valuesCache: Readonly<Partial<SessionProjectionMap>> | undefined // 整体值快照缓存
  /** Coarse any-key channel (no snapshot cache to rebuild: reads hit rows directly). */
  /* 粗粒度的任意键通道（无快照缓存可重建：读直接命中 rows）。 */
  private readonly anyNotifier = new Notifier(() => {})

  /**
   * Key-addressed bare observable face (the useProjection resolution path).
   * Always defined — absence is an `undefined` snapshot, never a missing
   * face, so a component may subscribe before the key ever carries a value.
   * @param key - projection key.
   * @returns the identity-stable face for this key.
   */
  /*
   * 按键寻址的裸可观察面（useProjection 的解析路径）。总是存在——缺失是
   * undefined 快照，绝不是缺少面，因此组件可在键尚未携带值前订阅。
   * @param key 投影键。
   * @returns 该键身份稳定的面。
   */
  faceOf(key: string): ObservableSnapshot<unknown> {
    return this.channel(key).face
  }

  /**
   * Current whole value for a key (erased framework read; typed reads go
   * through `useProjection`'s map lookup).
   * @param key - projection key.
   * @returns the value, or undefined while the key is absent.
   */
  /*
   * 一个键的当前完整值（擦除类型的框架读；类型化读取走 useProjection 的
   * 映射查找）。
   * @param key 投影键。
   * @returns 值；键缺失时为 undefined。
   */
  get(key: string): unknown {
    return this.rows.get(key)?.value
  }

  /**
   * Read every current projection value as one reference-stable snapshot.
   * @returns The same frozen value map until a row changes.
   */
  /*
   * 把所有当前投影值读成一个引用稳定的快照。
   * @returns 同一份冻结值映射，直到某行变化。
   */
  values(): Readonly<Partial<SessionProjectionMap>> {
    if (this.valuesCache === undefined) {
      this.valuesCache = Object.freeze(Object.fromEntries(
        [...this.rows].map(([key, row]) => [key, row.value]),
      ))
    }
    return this.valuesCache
  }

  /**
   * Subscribe to any-key changes (microtask-batched) — the manager's list
   * rebuild channel.
   * @param listener - change callback.
   * @returns the unsubscribe function.
   */
  /*
   * 订阅任意键的变更（微任务批处理）——管理器的列表重建通道。
   * @param listener 变更回调。
   * @returns 取消订阅函数。
   */
  subscribeAny(listener: () => void): () => void {
    return this.anyNotifier.subscribe(listener)
  }

  /**
   * Apply one finished value from the Session control stream.
   * @param key - projection key.
   * @param value - whole value computed by the host unit.
   * @param seq - the unit's watermark at emission.
   */
  apply(key: string, value: unknown, seq: SessionSeqCursor): void {
    const row = this.rows.get(key)
    if (row !== undefined && seq <= row.seq) return // higher seq wins; replays and stale frames drop
    // seq 更大者胜；重放与陈旧帧被丢弃
    this.rows.set(key, { value, seq })
    this.changed(key)
  }

  /**
   * Seed from a history tail page's projections block: every carried key
   * lands under the same seq rule as frames; a key the block omits is
   * capability-absent as of the cut — its row clears unless a newer frame
   * already superseded the cut (a stale baseline can neither overwrite nor
   * clear newer values).
   * @param baseline - the response's projections block.
   */
  /*
   * 从历史尾部页的 projections 块播种：每个携带的键按与帧相同的 seq 规则
   * 落地；块省略的键在切割处为能力缺失——除非已有更新的帧超越该切割，
   * 否则清空其行（陈旧基线既不能覆盖也不能清除更新的值）。
   * @param baseline 响应的 projections 块。
   */
  seed(baseline: ProjectionsBaseline): void {
    // Erased walk: the framework crosses the open key space; per-key typing
    // is re-established at the consumer (useProjection's map lookup).
    // 擦除类型的遍历：框架跨越开放键空间；按键类型在消费方重建
    // （useProjection 的映射查找）。
    const values = baseline.values as Record<string, unknown>
    for (const key of Object.keys(values)) this.apply(key, values[key], baseline.asOfSeq)
    for (const [key, row] of this.rows) {
      if (Object.hasOwn(values, key)) continue
      if (row.seq > baseline.asOfSeq) continue
      this.rows.delete(key)
      this.changed(key)
    }
  }

  /**
   * Drop rows beyond a replacement control baseline. Such rows describe
   * process state the Host lost before persisting it and would otherwise
   * outrank recomputed lower-seq values forever. The caller seeds the new
   * baseline immediately afterward.
   * @param lastSeq - highest durable sequence reflected by the baseline.
   */
  truncate(lastSeq: SessionSeqCursor): void {
    for (const [key, row] of this.rows) {
      if (row.seq <= lastSeq) continue
      this.rows.delete(key)
      this.changed(key)
    }
  }

  /** 行变更后的内部通知：失效值快照并标记对应通道 + 任意键通道。 */
  private changed(key: string): void {
    this.valuesCache = undefined
    this.channels.get(key)?.notifier.markDirty()
    this.anyNotifier.markDirty()
  }

  /** 按键获取（或按需创建并缓存）通知通道。 */
  private channel(key: string): Channel {
    let channel = this.channels.get(key)
    if (channel === undefined) {
      // The notifier only batches (no snapshot cache to rebuild: faces read rows directly).
      // 通知器只做批处理（无快照缓存可重建：面直接读 rows）。
      const notifier = new Notifier(() => {})
      channel = {
        notifier,
        face: {
          getSnapshot: () => this.rows.get(key)?.value,
          subscribe: listener => notifier.subscribe(listener),
        },
      }
      this.channels.set(key, channel)
    }
    return channel
  }
}
