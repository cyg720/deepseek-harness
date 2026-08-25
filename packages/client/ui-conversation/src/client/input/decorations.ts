/**
 * ================================ 文件注释 ================================
 * 【文件职责】草稿装饰的纯核心：从输入状态推导镜像层的装饰产物——引用令牌高亮范围、
 *             chip 渲染指令、纯文本引用范围与幽灵提示文本。零 React，测试直接驱动。
 * 【技术维度】纯函数；两个正则扫描纯文本引用（/name、@name 与 @folder/ 语法）；
 *             chips 从 occurrences 表投影（offset 排序）。
 * 【产品维度】输入框背层渲染引用 chip、被认领命令令牌的高亮与参数提示。
 * 【逻辑维度】1) 三种装饰数据结构；2) scanTextRefs 扫描（词边界纪律 + 词典命中）；
 *             3) deriveDecorations 从输入状态合成全部装饰。
 * 【关键边界】引用令牌只在 claimed/submitting 且草稿以令牌开头时高亮；编辑文本使其
 *             脱离匹配形状，下一个扫描周期自然丢弃该范围。
 * 【新手阅读建议】先读 DraftDecorations 四个字段，再看 scanTextRefs 的匹配纪律。
 * ==========================================================================
 */
/**
 * Draft decoration pure core (references render from occurrence ranges; the
 * claim token renders as a mirror-layer
 * highlight, the claim hint as ghost text). Zero React — the skeleton renders
 * the instructions; tests drive this directly.
 */
import type { InputState } from './contract.ts'

/** The claim-token highlight range (always draft-leading while the watch holds). */
export interface TokenRange {
  readonly start: number
  readonly end: number
}

/** One structured inline-reference render instruction. */
export interface ChipRender {
  /** Stable render key (same-labeled chips stay independent). */
  readonly occurrenceId: number
  /** Display-text offset in the draft. */
  readonly offset: number
  /** Display-text length in the draft. */
  readonly length: number
  /** Exact inline text whose native glyph metrics determine layout. */
  readonly text: string
  readonly label: string
  /** Optional domain glyph beside the label. */
  readonly appearance?: 'session' | 'file' | 'folder'
  /** Owner-resolution failure styling bit. */
  readonly invalid: boolean
}

/**
 * One plain-text reference range (the plain-text-reference decision;
 * see .agents/notes/implemented/architecture/2026-07-25-web-input-machine-and-slash-pipeline.md):
 * a `/name` or `@name` token
 * whose name is on the trigger's lexicon. Pure derivation — editing the text
 * out of match shape simply drops the range next scan.
 */
export interface TextRefRange {
  readonly start: number
  readonly end: number
  readonly trigger: '/' | '@'
  /** Optional icon domain for syntax-recognizable plain references. */
  readonly appearance?: 'folder'
}

/** Decoration product: claim token range + chip instructions + text-ref ranges + the ghost hint. */
export interface DraftDecorations {
  /** Claim token range while claimed/submitting and the prefix watch holds; null otherwise. */
  readonly token: TokenRange | null
  /** Chip render instructions in draft order (occurrence table is offset-sorted). */
  readonly chips: readonly ChipRender[]
  /** Scan-derived lexicon tokens and syntax-recognizable folder ranges. */
  readonly textRefs: readonly TextRefRange[]
  /** Ghost hint shown while the claim's args are blank; null otherwise. */
  readonly hint: string | null
}

/** Token matcher: a trigger char at line start or after whitespace, then a word-ish name (never crosses \n). */
const TEXT_REF_RE = /(^|\s)([/@])([\w-]+)/g
const FOLDER_REF_RE = /(^|\s)(@(?:"[^"\n]*\/|[^\s"]+\/))/g

/**
 * Scan the draft for plain-text reference tokens against the hot lexicons.
 * Word-boundary discipline: the trigger must sit at the draft
 * start or after whitespace ('x/name' never matches); the name must be an
 * exact lexicon member.
 * @param draft - draft text.
 * @param lexicon - per-trigger name lists (a missing trigger scans nothing).
 * @returns matched ranges in draft order.
 */
/*
 * 按热词典扫描草稿中的纯文本引用令牌。词边界纪律：触发器必须位于草稿开头或空白之后
 * （'x/name' 永不匹配）；名字必须是词典的精确成员。
 * @param draft - 草稿文本。
 * @param lexicon - 按触发符区分的名字列表（缺失的触发符不扫描）。
 * @returns 按草稿顺序排列的命中范围。
 */
export function scanTextRefs(
  draft: string, lexicon: ReadonlyMap<'/' | '@', readonly string[]>,
): TextRefRange[] {
  if (draft === '') return []
  const out: TextRefRange[] = []
  if (lexicon.size > 0) {
    TEXT_REF_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = TEXT_REF_RE.exec(draft)) !== null) {
      const trigger = m[2] as '/' | '@'
      const name = m[3] ?? ''
      if (lexicon.get(trigger)?.includes(name)) {
        const start = m.index + (m[1]?.length ?? 0)
        out.push({ start, end: start + 1 + name.length, trigger })
      }
    }
  }
  FOLDER_REF_RE.lastIndex = 0
  let folder: RegExpExecArray | null
  while ((folder = FOLDER_REF_RE.exec(draft)) !== null) {
    const token = folder[2] ?? ''
    const start = folder.index + (folder[1]?.length ?? 0)
    const end = start + token.length
    if (!out.some(range => range.start < end && range.end > start)) {
      out.push({ start, end, trigger: '@', appearance: 'folder' })
    }
  }
  return out.sort((left, right) => left.start - right.start)
}

/** The empty lexicon (default: zero text-ref decorations, old call sites unchanged). */
const EMPTY_LEXICON: ReadonlyMap<'/' | '@', readonly string[]> = new Map()

/**
 * Derive the mirror-layer decorations from the input state.
 * @param state - published input state.
 * @param lexicon - optional per-trigger reference lexicons (plain-text-reference scan).
 * @returns token range, chip instructions, text-ref ranges, and the ghost hint.
 */
export function deriveDecorations(
  state: InputState, lexicon: ReadonlyMap<'/' | '@', readonly string[]> = EMPTY_LEXICON,
): DraftDecorations {
  const { draft, claim, phase, occurrences } = state
  const claimActive = (phase === 'claimed' || phase === 'submitting')
    && claim !== undefined && draft.startsWith(claim.token)
  const token: TokenRange | null = claimActive ? { start: 0, end: claim.token.length } : null
  const chips = occurrences.map(o => ({
    occurrenceId: o.occurrenceId,
    offset: o.offset,
    length: o.length,
    text: draft.slice(o.offset, o.offset + o.length),
    label: o.label,
    ...o.appearance === undefined ? {} : { appearance: o.appearance },
    invalid: o.invalid === true,
  }))
  const hint = claimActive && claim.hint !== undefined && draft.slice(claim.token.length).trim() === ''
    ? claim.hint
    : null
  return { token, chips, textRefs: scanTextRefs(draft, lexicon), hint }
}
