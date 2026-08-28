/*
 * ================================ 文件注释 ================================
 * 【文件职责】设置命名空间（settings namespace）的作用域契约：每个拥有
 *   偏好的功能都依赖本类型，而实现与 Host 传输在 Settings 表面
 *   （dsh-client-ui-settings）中。
 * 【技术维度】纯类型契约 + 泛型：SettingsScopeSnapshot 描述同步状态机，
 *   SettingsScope 是响应式 owner 句柄（getSnapshot/subscribe/set/unset）。
 * 【产品维度】功能插件通过 attachSettings 接受一个作用域，而不依赖绑定它的
 *   表面，避免引用环；用户偏好写操作按 revision 防止旧值覆盖新值。
 * 【逻辑维度】快照含 status/value/base/user/revision/writable/mode 六类事实；
 *   set/unset 排队写入，保持顺序与最新 revision，失败时回读 Host 状态。
 * 【关键边界】memory 模式下不可写；user 层的存在性标记覆盖（值等于默认
 *   仍算覆盖）；revision 是下一次写入的围栏。
 * 【新手阅读建议】先理解"命名空间、wire 段、user 层与组合层"的模型。
 * ==========================================================================
 */
/**
 * Settings-namespace scope contracts owned beside the settings transport.
 */
/*
 * 设置命名空间的作用域契约。类型放在每个拥有偏好的功能共同依赖处，而实现
 * 与 Host 传输在 Settings 表面（dsh-client-ui-settings）：功能服务通过
 * attachSettings 接受作用域，而不依赖绑定它的表面，否则会形成引用环。
 */

import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'

/** Client-side sync state of one settings namespace. */
/* 单个设置命名空间在客户端的同步状态。 */
export interface SettingsScopeSnapshot<T> {
  /**
   * `loading` until the first accepted section, `ready` while one stands, and
   * `unavailable` when the namespace is not exposed to this client or the
   * connection keeps preferences process-local (memory mode).
   */
  /*
   * 收到第一个被接受的段之前为 loading；有段存在时为 ready；命名空间未对
   * 本客户端暴露、或连接把偏好保持为进程本地（memory 模式）时为 unavailable。
   */
  status: 'loading' | 'ready' | 'unavailable'
  /** Last accepted schema-resolved section; undefined before the first acceptance. */
  /* 最近一次被接受且经 schema 解析的段；首次接受前为 undefined。 */
  value: T | undefined
  /**
   * Composition layer the Host resolved {@link value} over, when the owning
   * plugin declared one. What a field reverts to once cleared.
   */
  /*
   * Host 解析 value 所基于的组合层（当属主插件声明了它时）。字段被清除后
   * 回退到的值来源。
   */
  base: unknown
  /**
   * Raw user layer as stored, when one exists. A field's PRESENCE here is what
   * marks it overridden — an override whose value equals the composition
   * default is still an override, and comparing values could not see it.
   */
  /*
   * 存储的原始用户层（若有）。字段在 user 层中的"存在性"标记它被覆盖——
   * 值等于组合层默认的覆盖仍是覆盖，仅比较值无法发现。
   */
  user: unknown
  /** Namespace revision fencing the next write; undefined before the first Host view. */
  /* 为下一次写入做围栏的命名空间修订号；首次 Host 视图前为 undefined。 */
  revision: number | undefined
  /** Whether the Host document accepts writes; memory mode never does. */
  /* Host 文档是否接受写入；memory 模式从不接受。 */
  writable: boolean
  /** `host` syncs with the Host document; `memory` keeps a remote browser process-local. */
  /* host 模式与 Host 文档同步；memory 模式把偏好保留在远端浏览器进程内。 */
  mode: 'host' | 'memory'
}

/** Domain-owned description of one settings namespace consumed by a browser plugin. */
/* 浏览器插件消费的、域拥有的单个设置命名空间描述。 */
export interface SettingsScopeSpec<T> {
  /** Settings namespace registered by the owning Host plugin. */
  /* 由属主 Host 插件注册的设置命名空间名。 */
  namespace: string
  /**
   * Narrow one wire section; undefined keeps the last accepted value. The
   * default validates the section against the namespace's own serialized wire
   * schema, so domains add a decoder only to narrow beyond that schema.
   */
  /*
   * 收窄一个 wire 段；undefined 表示保留最近接受的值。默认会用命名空间自身
   * 的序列化 wire schema 校验该段，因此域只在需要超越该 schema 的收窄时
   * 才提供解码器。
   */
  decode?: (section: unknown) => T | undefined
}

/**
 * Reactive owner handle over one namespace's durable section — the browser
 * mirror of the Host-side `SettingsScope` owner seam. Domain services read
 * and observe the snapshot and route explicit user choices through its
 * mutation methods.
 */
/*
 * 单个命名空间持久段的响应式 owner 句柄——Host 侧 SettingsScope owner
 * 缝（seam）的浏览器镜像。域服务读取并观察快照，通过 set 写入显式用户选择。
 */
export interface SettingsScope<T> {
  /** @returns the current sync snapshot (stable reference until the next change). */
  /* @returns 当前同步快照（下次变更前引用稳定）。 */
  getSnapshot(): SettingsScopeSnapshot<T>
  /**
   * Observe snapshot replacements.
   * @param listener - invoked after each snapshot change.
   * @returns the disposer removing this listener.
   */
  /*
   * 观察快照替换。
   * @param listener 每次快照变更后调用。
   * @returns 移除该监听器的销毁函数。
   */
  subscribe(listener: () => void): () => void
  /**
   * Queue one atomic namespace mutation. All operations share one revision
   * fence, Host validation, persistence decision, and recovery read. Supplying
   * `expectedRevision` preserves an earlier read as the fence instead of using
   * the latest queued or mirrored revision.
   * @param ops - ordered field operations copied when queued.
   * @param expectedRevision - optional fixed revision read by the domain editor.
   * @returns settlement after the mutation and any latest-write recovery read.
   */
  mutate(ops: readonly SettingsPathOpView[], expectedRevision?: number): Promise<void>
  /**
   * Queue one field write. Rapid writes preserve mutation order, each carries
   * the latest known namespace revision, and only the latest settlement may
   * publish; a rejected or failed latest write reloads Host state instead.
   * @param field - scalar field inside the namespace section.
   * @param value - JSON-shaped value selected by the user.
   * @returns settlement after the write and any latest-write recovery read.
   */
  /*
   * 排队一次字段写入。快速连续写入保持变更顺序，每次携带最新已知命名空间
   * 修订号，只有最新一次的结算可以发布；最新写入被拒或失败时改为回读
   * Host 状态。
   * @param field 命名空间段内的标量字段。
   * @param value 用户选择的 JSON 形态值。
   * @returns 写入结算，以及最新写入的恢复读结果。
   */
  set(field: string, value: unknown): Promise<void>
  /**
   * Queue one field clear, so the field re-inherits the composition layer.
   * Shares {@link set}'s ordering, revision, and recovery contract.
   * @param field - scalar field inside the namespace section.
   * @returns settlement after the clear and any latest-write recovery read.
   */
  /*
   * 排队一次字段清除，使字段重新继承组合层。
   * 与 set 共享排序、修订号与恢复契约。
   * @param field 命名空间段内的标量字段。
   * @returns 清除结算，以及最新写入的恢复读结果。
   */
  unset(field: string): Promise<void>
}
