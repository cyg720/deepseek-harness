/**
 * ================================ 文件注释 ================================
 * 【文件职责】上下文来源（context provenance）投影：仅凭一条持久化的非用户
 *   user/message 的 source 字段，读出它的角色与人类可读的生产者名称。
 * 【技术维度】纯函数 + 防御性解析：source 是合并可扩展的 JSON（客户端无法
 *   穷举），所有不可读形状都安全降级；客户端不维护已知插件 id 表。
 * 【产品维度】转写（transcript）中展示的每条注入/回忆上下文都应有清晰的
 *   来源标签（指令路径、被引用会话标题、插件名、技能名），即使日志由
 *   更新的或外部生产者写入也能渲染。
 * 【逻辑维度】asRecord/readString/collect/joined 是解析小工具；
 *   sessionRecallLabels 取被引用会话标签；contextProvenance 投影角色与
 *   标签；contextForm 识别本版本能展示的上下文形态。
 * 【关键边界】未知 kind 降级为 'inject' + 用 kind 本身当标签；不可读形状
 *   标签为 null；contextForm 只认 KNOWN_FORMS 白名单。
 * 【新手阅读建议】先理解 user/message 的 source 各字段含义。
 * ==========================================================================
 */
// Context source projection: the role and the human-facing producer name
// of one logged non-user `user/message`, read from its durable `source` alone.
// The client keeps no table of known plugin ids — a renamed or newly mounted
// producer must never need a client release to stay identifiable, and a resumed
// or foreign log must project the same way as a live one.
// 上下文来源投影：一条已记录的非用户 user/message 的角色与人类可读的生产者
// 名称，仅从其持久化 source 读出。客户端不维护已知插件 id 表——重命名或
// 新挂载的生产者无需客户端发版即可保持可识别，恢复或外部日志也必须与
// 实时日志以同样方式投影。

/**
 * Which model-facing role a logged non-user message plays.
 *
 * `recall` marks material lifted out of another session's log; `inject` marks
 * every other producer-supplied context. Mid-turn steering is the third role
 * the transcript distinguishes, but it has its own event and node kind
 * (`steering/message` / `SteeringMessageNode`) and never reaches here.
 */
/*
 * 一条已记录的非用户消息在模型面向上扮演的角色。
 *
 * recall 标记从另一个会话日志中提取的材料；inject 标记所有其他生产者
 * 提供的上下文。转写还区分第三种角色——轮次中的 steering，但它有自己
 * 的事件与节点类型（steering/message / SteeringMessageNode），不会到这里。
 */
export type ContextRole = 'inject' | 'recall'

/** Role and producer name presented for one logged non-user message. */
/* 为一条已记录的非用户消息呈现的角色与生产者名称。 */
export interface ContextProvenanceView {
  /** The role this context plays in the model-facing conversation. */
  /* 该上下文在模型面对话中扮演的角色。 */
  role: ContextRole
  /**
   * Producer name for the row header, taken from the durable source: the
   * instruction paths, the referenced session titles, the plugin id, or the
   * bare source kind for a producer this UI version does not know. Null only
   * when the source carries no readable kind at all.
   */
  /*
   * 行头的生产者名称，取自持久化 source：指令路径、被引用会话标题、
   * 插件 id，或本 UI 版本不认识的生产者的裸来源 kind。仅当 source
   * 完全不带可读 kind 时才为 null。
   */
  label: string | null
}

/** One durable source narrowed to the readable-record shape; null for anything else. */
/* 把持久化 source 收窄为可读的记录形状；其他一律 null。 */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/** A record field read as a non-empty string, or null. */
/* 读取记录字段为非空字符串；否则 null。 */
function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** Distinct non-empty `field` values of an array-valued source member, in first-seen order. */
/* 收集数组型 source 成员中互异的非空 field 值，按首次出现顺序。 */
function collect(source: Record<string, unknown>, member: string, field: string): string[] {
  const list = source[member]
  if (!Array.isArray(list)) return []
  const seen: string[] = []
  for (const entry of list) {
    const record = asRecord(entry)
    const value = record === null ? null : readString(record, field)
    if (value !== null && !seen.includes(value)) seen.push(value)
  }
  return seen
}

/** A collected name list rendered as one label; null when the list is empty. */
/* 把收集到的名称列表渲染为单个标签；列表为空时 null。 */
function joined(names: string[]): string | null {
  return names.length > 0 ? names.join(', ') : null
}

/**
 * The referenced-session labels of one durable `session-reference` recall
 * source, in first-seen order; empty for every other source shape, including
 * a foreign or older log whose reference entries carry no readable label.
 * @param source - the logged `user/message` source, exactly as recorded.
 * @returns distinct non-empty reference labels.
 */
/*
 * 一个持久化 session-reference 回忆来源的被引用会话标签，按首次出现顺序；
 * 其他所有 source 形状返回空数组，包括引用条目无可读标签的外部或旧日志。
 * @param source 记录中的 user/message source，与日志一致。
 * @returns 互异的非空引用标签。
 */
export function sessionRecallLabels(source: unknown): string[] {
  const record = asRecord(source)
  if (record === null || readString(record, 'kind') !== 'session-reference') return []
  return collect(record, 'references', 'label')
}

/**
 * Project one durable message source onto its transcript role and producer name.
 *
 * The source arrives over the wire as opaque JSON (`MessageSource` is
 * merge-extensible, so no client-side union can be exhaustive), and a durable
 * log may predate or postdate this UI; every unreadable shape therefore
 * degrades to `inject` with whatever name the record still carries.
 * @param source - the logged `user/message` source, exactly as recorded.
 * @returns the role and producer name to present for this context.
 */
/*
 * 把一个持久化消息 source 投影到它的转写角色与生产者名称。
 *
 * source 以不透明 JSON 形式经线上到达（MessageSource 是合并可扩展的，
 * 客户端侧联合无法穷举），持久化日志也可能早于或晚于本 UI；因此一切
 * 不可读形状都降级为 inject，并尽量使用记录仍携带的名称。
 * @param source 记录中的 user/message source，与日志一致。
 * @returns 该上下文的角色与要呈现的生产者名称。
 */
export function contextProvenance(source: unknown): ContextProvenanceView {
  const record = asRecord(source)
  const kind = record === null ? null : readString(record, 'kind')
  if (record === null || kind === null) return { role: 'inject', label: null }
  switch (kind) {
    // Cross-session snapshots are the one durable source that carries another
    // session's material; its references name the sessions they were read from.
    // 跨会话快照是唯一携带其他会话材料的持久化来源；其 references 列出
    // 材料来自哪些会话。
    case 'session-reference':
      return { role: 'recall', label: joined(collect(record, 'references', 'label')) ?? kind }
    // Workspace instructions name the files they were reconciled from, which
    // identifies the producer far better than the plugin id would.
    // 工作区指令以其调和来源的文件命名，比插件 id 更能标识生产者。
    case 'agent-instructions':
      return { role: 'inject', label: joined(collect(record, 'changes', 'path')) ?? kind }
    case 'plugin':
      return { role: 'inject', label: readString(record, 'plugin') ?? kind }
    // A user-explicit skill invocation names the skill it injected.
    // 用户显式技能调用以其注入的技能命名。
    case 'skill-invocation':
      return { role: 'inject', label: readString(record, 'name') ?? kind }
    // Documented default arm of the merge-extensible source map: an unknown
    // producer still identifies itself by its own durable kind.
    // 合并可扩展 source 映射的有文档默认分支：未知生产者仍用自己的
    // 持久化 kind 自我标识。
    default:
      return { role: 'inject', label: kind }
  }
}

/**
 * Context forms this UI version renders with a dedicated presentation. The
 * durable vocabulary (`ContextForm` in `dsh-llm`) may already be wider — an
 * unrecognized or absent value degrades to the opaque presentation rather than
 * dropping the row, so a log written by a newer or foreign producer still
 * renders.
 */
/*
 * 本 UI 版本以专门呈现方式渲染的上下文形态。持久化词汇表（dsh-llm 中的
 * ContextForm）可能已经更宽——无法识别或缺失的值降级为不透明呈现而非
 * 丢弃该行，因此由更新或外部生产者写入的日志仍能渲染。
 */
const KNOWN_FORMS = ['instructions', 'catalog', 'snapshot', 'notice', 'relay', 'recall'] as const

/** One durable context form this UI version knows how to present. */
/* 本 UI 版本知道如何呈现的一种持久化上下文形态。 */
export type KnownContextForm = typeof KNOWN_FORMS[number]

/**
 * Read the producer-declared form off one durable message source.
 * @param source - the logged `user/message` source, exactly as recorded.
 * @returns the form when this UI version presents it, otherwise null (opaque).
 */
/*
 * 从持久化消息 source 读取生产者声明的形态。
 * @param source 记录中的 user/message source，与日志一致。
 * @returns 本 UI 版本能呈现时返回该形态，否则 null（不透明）。
 */
export function contextForm(source: unknown): KnownContextForm | null {
  const record = asRecord(source)
  const form = record === null ? null : readString(record, 'form')
  return form !== null && (KNOWN_FORMS as readonly string[]).includes(form)
    ? form as KnownContextForm
    : null
}
