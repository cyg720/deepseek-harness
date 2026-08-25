/**
 * ================================ 文件注释 ================================
 * 【文件职责】TerminalBlock 背后的 ANSI 渲染模型：先用 anser 把 SGR（终端颜色/样式）序列
 *             拆成一段段 run，本模块把每个 run 的颜色与装饰解析成普通样式对象，并把 run
 *             按行折叠成 span 数组，让高度上限可以按整行切片。anser 无法转成颜色的序列
 *             （OSC、光标移动、其它 C0 控制符）在解析前被清除，绝不让它们以字面字符进入 DOM。
 * 【技术维度】正则逐类清除转义序列；自研"列缓冲"回放光标移动（\r、退格、清行 K），
 *             把当前 SGR 状态按单元（cell）保存；宽字符（CJK/emoji）占两列，零宽字符不占列。
 * 【产品维度】AI 执行命令后的终端输出必须与真实终端所见一致——进度条、spinner、彩色输出
 *             在对话卡片里原样复现，用户才能相信"这就是终端里跑出来的结果"。
 * 【逻辑维度】1) 颜色/装饰常量表（TOKEN_BY_BASIC_RGB、STYLE_BY_DECORATION）与转义正则；
 *             2) SgrState 状态 + foldSgr / openSgr / sameSgr 状态折叠；3) replayLine 按列
 *             回放一行光标移动；4) applyCursorMovements 逐行回放并跨行传递状态；
 *             5) sanitize 清除非颜色序列；6) resolveStyle 解析单 run 样式；
 *             7) 导出 parseAnsiLines 输出按行分组的 span。
 * 【关键边界】记录"当前状态"而非序列历史，避免 O(n^2) 输出（曾致 RangeError）；blink 动画
 *             不重现；reverse 由 anser 消费（交换前后景）；隐藏行数为 0 的样式返回 undefined；
 *             回放需要满足真实终端语义（如 100%\rOK 显示 OK0%）。
 * 【新手阅读建议】先看 parseAnsiLines 的输入输出，再读 replayLine 理解"列缓冲"为什么能
 *             正确还原 \r 重绘；状态折叠三个函数是理解 SGR 的关键。
 * ==========================================================================
 */
// ANSI model behind TerminalBlock: anser splits the SGR runs, this module
// resolves each run's colors and decorations into a plain style record and
// folds the runs into per-line span arrays so a height cap can slice whole
// lines. Sequences anser does not turn into color (OSC, cursor movement,
// other C0 controls) are removed before parsing so they never reach the DOM
// as literal characters.
// 一句话概括：输入任意带 ANSI 转义序列的终端文本，输出"按行分组、带内联样式"的文本
// 片段数组，且与真实终端的显示一致（含光标重绘、宽字符、颜色状态）。
import Anser from 'anser'
import type { CSSProperties } from 'react'

/**
 * The subset of one anser JSON chunk this module reads. anser's own types
 * declare `fg`/`bg` as `string`, but its parser leaves them `null` for a run
 * that sets no color, so the null is spelled out here.
 */
// anser 输出的一个 JSON 片段中本模块关心的字段。anser 自己的类型把 fg/bg 声明为 string，
// 但它的解析器对"未设置颜色"的 run 实际给 null，所以这里把 null 显式写出来。
interface AnsiChunk {
  /** Run text with its SGR codes already removed. */
  // run 的文本（SGR 码已被 anser 移除）。
  content: string
  /** Foreground as an `r, g, b` triple, or null when the run sets none. */
  // 前景色，形如 "r, g, b"；未设置时为 null。
  fg: string | null
  /** Background as an `r, g, b` triple, or null when the run sets none. */
  // 背景色，形如 "r, g, b"；未设置时为 null。
  bg: string | null
  /** SGR attributes in effect for the run, in the order they were declared. */
  // 该 run 生效的 SGR 属性（如 bold、underline），按声明顺序排列。
  decorations: readonly string[]
}

/** One run of terminal text; `style` is undefined for text that carries no SGR state. */
/*
 * 一段终端文本：style 为 undefined 表示这段文本没有任何 SGR 样式，无需包裹。
 */
export interface AnsiSpan {
  /** The run's plain text, free of escape sequences and newlines. */
  // run 的纯文本，不含转义序列与换行。
  text: string
  /** Resolved inline style, or undefined when the run needs no wrapper. */
  // 解析后的内联样式；无样式时为 undefined。
  style: CSSProperties | undefined
}

/** The spans of one output line, in order. */
// 一行输出对应的 span 列表（按顺序）。
export type AnsiLine = readonly AnsiSpan[]

/**
 * The 8/16 basic ANSI colors, keyed by the whitespace-free `r,g,b` triple
 * anser emits for them, mapped onto the theme tokens that carry the same
 * semantic. Black and white both resolve to the primary label color so text
 * stays legible under either theme instead of matching the surface it sits
 * on; bright black takes the tertiary label color (the muted-gray role).
 * Magenta and cyan have no token equivalent in this design system and fall
 * through to anser's literal rgb, as do all 256-palette and truecolor values.
 */
// 16 种基础 ANSI 颜色到主题 token 的映射表（键是 anser 输出的无空格 "r,g,b" 三元组）。
// 黑/白都映射到主标签色，保证浅色/深色主题下都清晰而不与表面同色；品红与青在设计系统里
// 没有对应 token，与 256 色和真彩色一起落到 anser 的字面 rgb。
const TOKEN_BY_BASIC_RGB: Record<string, string> = {
  '0,0,0': 'var(--dsw-alias-label-primary)',
  '255,255,255': 'var(--dsw-alias-label-primary)',
  '85,85,85': 'var(--dsw-alias-label-tertiary)',
  '187,0,0': 'var(--dsw-alias-state-error-primary)',
  '255,85,85': 'var(--dsw-alias-state-error-secondary)',
  '0,187,0': 'var(--dsw-alias-state-success-primary)',
  '0,255,0': 'var(--dsw-alias-state-success-secondary)',
  '187,187,0': 'var(--dsw-alias-state-warn-primary)',
  '255,255,85': 'var(--dsw-alias-state-warn-secondary)',
  '0,0,187': 'var(--dsw-alias-state-business-primary)',
  '85,85,255': 'var(--dsw-static-blue-400)',
}

/**
 * CSS for each SGR attribute anser reports. `blink` is deliberately absent —
 * animated text is not reproduced. `reverse` never arrives here: anser
 * consumes it by swapping the run's foreground and background. Underline and
 * strikethrough share `textDecoration`, so in a run declaring both, the
 * later declaration wins.
 */
// SGR 装饰属性对应的 CSS。blink（闪烁动画）刻意不重现；reverse 不会到这里（anser 已把它
// 变成前后景互换）；underline 与 strikethrough 共用 textDecoration，同时声明时后写的生效。
const STYLE_BY_DECORATION: Record<string, CSSProperties | undefined> = {
  bold: { fontWeight: 700 },
  dim: { opacity: 0.7 },
  italic: { fontStyle: 'italic' },
  underline: { textDecoration: 'underline' },
  strikethrough: { textDecoration: 'line-through' },
  hidden: { visibility: 'hidden' },
}

/** OSC strings (window title, hyperlinks), with or without their terminator. */
// OSC 序列（设置窗口标题、超链接等），带或不带结束符都要清掉。
const OSC_SEQUENCE = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g

/** Escape sequences other than CSI: charset selection, single-shift, reset. */
// 除 CSI 之外的转义序列（字符集选择、单次移位、复位等）。
const NON_CSI_ESCAPE = /\u001b(?!\[)[\u0020-\u002f]*[\u0030-\u007e]?/g

/**
 * C0 controls with no display meaning here. Tab, newline, backspace and ESC
 * survive: the first two for layout, backspace for the cursor replay, ESC
 * for anser's CSI split.
 */
// 在本场景没有显示意义、应清除的 C0 控制符。Tab、换行、退格与 ESC 保留：
// 前两个用于布局，退格用于光标回放，ESC 是 anser 拆分 CSI 的依据。
const INERT_CONTROL = /[\u0000-\u0007\u000b-\u001a\u001c-\u001f\u007f]/g

/**
 * Lines whose cursor movements have to be replayed: a carriage return, a
 * backspace, or an erase-in-line. The erase pattern matches the SAME CSI shape
 * `replayLine` parses (parameters may carry `;` and intermediate bytes), so a
 * form like `\x1b[1;2K` cannot slip past this guard and skip its own erase.
 */
// 需要回放光标移动的行：含回车、退格或"清行"（erase-in-line）。清行模式与 replayLine
// 解析的 CSI 形状一致（参数可带 `;` 与中间字节），因此 `\x1b[1;2K` 无法绕过本守卫跳过清行。
const NEEDS_REPLAY = /\r|\u0008|\u001b\[[\u0030-\u003f]*[\u0020-\u002f]*K/

/** SGR sequences alone, for folding state through a line that needs no replay. */
// 仅 SGR 序列：用于给"无需回放"的行折叠状态（见 applyCursorMovements）。
const SGR_SEQUENCE = /\u001b\[([\u0030-\u003f]*)[\u0020-\u002f]*m/g

/** Terminal tab stop width; a tab advances to the next multiple of this. */
// 终端制表位宽度：Tab 前进到下一个该值的整数倍列。
const TAB_WIDTH = 8

/**
 * Combining marks and other zero-width code points: a terminal advances no
 * column for them, so `e` + U+0301 occupies one cell and a two-column redraw
 * covers both code points.
 */
// 组合记号等零宽码点：终端不为它们前进列，所以 e + U+0301 只占一个单元格，
// 两列重绘能同时覆盖这两个码点。
const ZERO_WIDTH = /^[\p{Mn}\p{Me}\p{Cf}\u200b-\u200f\u2060]$/u

/**
 * Characters a terminal advances two columns for: CJK scripts, fullwidth forms,
 * CJK punctuation, and characters with emoji presentation. Text-presentation
 * symbols (`\u2713`, `\u26a0` and the rest of U+2600-U+27BF) are ONE column and
 * must stay out of this set.
 */
// 终端会占两列的字符：CJK 文字、全角形式、CJK 标点与 emoji 呈现字符。
// 文本呈现符号（如 \u2713 对勾）只占一列，必须排除在本集合之外。
const WIDE_CHAR = new RegExp(
  '\\p{Script=Han}|\\p{Script=Hiragana}|\\p{Script=Katakana}|\\p{Script=Hangul}'
  // Emoji presentation only: the U+2600-U+27BF symbol block is mostly SINGLE
  // width — `\u2713` (the check every progress line writes, this fixture
  // included) advances one column, verified against a real terminal, so taking
  // the whole block as wide misaligned exactly the output this card exists for.
  + '|\\p{Emoji_Presentation}'
  + '|[\\uff01-\\uff60\\u3000-\\u303e]',
  'u',
)

/**
 * Whether a character occupies two terminal columns (CJK, fullwidth forms,
 * emoji). Covers the ranges a command's output realistically carries; a
 * narrower guess would misalign the columns this card exists to preserve.
 * @param char - one character from the output.
 * @returns true when the terminal advances two columns for it.
 */
/*
 * 判断字符是否占两个终端列（CJK、全角、emoji）。覆盖命令输出实际会带的区间；
 * 猜窄了会导致本卡片要保留的列对齐被破坏。
 * @param char - 输出中的单个字符。
 * @returns 终端为其前进两列时为 true。
 */
function isWide(char: string): boolean {
  const code = char.codePointAt(0)
  if (code === undefined || code < 0x1100) return false
  return WIDE_CHAR.test(char)
}

/**
 * A cell's graphic state, normalized. Held as fields rather than as the raw
 * sequence history because a terminal tracks CURRENT state, not a transcript:
 * accumulating sequences made each state boundary re-emit the whole chain, so
 * output that switches color without a full reset emitted O(n^2) characters
 * (3200 such cells produced 25 MB and eventually a `RangeError`). It also makes
 * the attribute closers every chalk-based tool writes — `39`, `49`, `22`, `23`,
 * `24`, `27`, `29` — actually close their attribute instead of appending to it.
 */
// 单元格的图形状态（归一化）。用"字段"而非"序列历史"保存，因为终端跟踪的是当前状态
// 而不是流水账：累积序列会让每个状态边界重发整条链，颜色切换且不全量复位时输出变成
// O(n^2)（3200 个单元产生 25MB 并最终 RangeError）；字段化还能让 chalk 类工具写的
// 属性关闭码（39/49/22/23/24/27/29）真正"关闭"属性而不是叠加。
interface SgrState {
  fg: string
  bg: string
  /** Attribute parameters in force, e.g. `1` (bold) or `4` (underline). */
  // 生效中的属性参数，如 `1`（加粗）或 `4`（下划线）。
  attrs: readonly string[]
}

/** The default state: no color, no attributes. */
// 默认状态：无颜色、无属性。
const SGR_NONE: SgrState = { fg: '', bg: '', attrs: [] }

/** Attribute closers, mapped to the opener parameters each one turns off. */
// 属性关闭码到"它要关掉的开启参数"的映射：22 关掉 1/2（加粗/弱化），23 关 3 等。
const ATTR_CLOSERS: Record<string, readonly string[]> = {
  22: ['1', '2'], 23: ['3'], 24: ['4'], 25: ['5', '6'], 27: ['7'], 28: ['8'], 29: ['9'],
}

/**
 * Fold one SGR sequence's parameters into the state it produces.
 * @param state - state in force before the sequence.
 * @param params - the sequence's raw parameter string (`31`, `1;4`, `38;5;208`).
 * @returns the state the sequence leaves in force.
 */
/*
 * 把一条 SGR 序列的参数折叠进它产生的状态。
 * @param state - 序列生效前的状态。
 * @param params - 序列的原始参数字符串（如 `31`、`1;4`、`38;5;208`）。
 * @returns 序列执行后应保持的状态。
 */
function foldSgr(state: SgrState, params: string): SgrState {
  const codes = params === '' ? ['0'] : params.split(';')
  let next = state
  for (let index = 0; index < codes.length; index++) {
    const code = String(codes[index])
    if (code === '' || code === '0') { next = SGR_NONE; continue }
    // Extended color: `38;5;N` / `38;2;R;G;B` and the `48` background pair
    // consume their own arguments, so they are taken whole.
    // 扩展色：`38;5;N`（256 色）/ `38;2;R;G;B`（真彩）与 `48` 背景对会吞掉自己的参数，
    // 因此整段取用，不能逐个参数处理。
    if (code === '38' || code === '48') {
      const kind = codes[index + 1] ?? ''
      const span = kind === '2' ? 4 : kind === '5' ? 2 : 0
      const value = codes.slice(index, index + span + 1).join(';')
      next = code === '38' ? { ...next, fg: value } : { ...next, bg: value }
      index += span
      continue
    }
    const closes = ATTR_CLOSERS[code]
    if (closes !== undefined) {
      next = { ...next, attrs: next.attrs.filter(attr => !closes.includes(attr)) }
      continue
    }
    const numeric = Number(code)
    if (code === '39') { next = { ...next, fg: '' }; continue }
    if (code === '49') { next = { ...next, bg: '' }; continue }
    if ((numeric >= 30 && numeric <= 37) || (numeric >= 90 && numeric <= 97)) { next = { ...next, fg: code }; continue }
    if ((numeric >= 40 && numeric <= 47) || (numeric >= 100 && numeric <= 107)) { next = { ...next, bg: code }; continue }
    if (!next.attrs.includes(code)) next = { ...next, attrs: [...next.attrs, code] }
  }
  return next
}

/**
 * Render a state as the one canonical sequence that establishes it from the
 * default, so a boundary emits a bounded string no matter how the state was
 * reached.
 * @param state - the state to open.
 * @returns the SGR sequence, or the empty string for the default state.
 */
/*
 * 把一个状态渲染成"从默认状态建立它"的唯一规范序列，保证任何状态边界只输出有界字符串。
 * @param state - 要开启的状态。
 * @returns SGR 序列；默认状态返回空字符串。
 */
function openSgr(state: SgrState): string {
  const codes = [...state.attrs]
  if (state.fg !== '') codes.push(state.fg)
  if (state.bg !== '') codes.push(state.bg)
  return codes.length === 0 ? '' : `\u001b[${codes.join(';')}m`
}

/** Whether two states are the same, so a boundary is only emitted on a change. */
// 两个状态是否相同：相同则不输出边界序列（只在状态变化时输出）。
function sameSgr(a: SgrState, b: SgrState): boolean {
  return a.fg === b.fg && a.bg === b.bg && a.attrs.length === b.attrs.length
    && a.attrs.every((attr, index) => attr === b.attrs[index])
}

/**
 * Replay one line's cursor movements the way a terminal paints it, into a
 * column buffer. Carriage return and backspace only MOVE the cursor — neither
 * erases anything — so what a reader sees is whatever each column last had
 * written to it. That distinction is the whole point of doing this as a buffer
 * rather than as string surgery: `100%\rOK` shows `OK0%` because the redraw is
 * shorter than the frame beneath it, and a trailing `abc\b` still shows `abc`
 * because nothing ever overwrote the `c`.
 *
 * A CSI sequence occupies no column; it changes the state that the NEXT writes
 * are stamped with, which is how a terminal stores color per cell. `red bad`
 * then three backspaces then `ok` therefore shows `okd` with the `d` still red:
 * `ok` overwrote two cells and the third kept the state it was written with.
 * The columns are re-emitted as runs, so anser sees that same styling.
 * @param line - one output line, still carrying its CSI sequences.
 * @param entrySgr - SGR state in force when the line begins, since a newline
 *   does not reset it.
 * @returns the line as the terminal would have it after every movement, plus the
 *   SGR state at its end for the next line to enter with.
 */
/*
 * 按终端实际绘制方式把一行的光标移动回放到"列缓冲"里。回车与退格只移动光标、
 * 不擦除任何东西，所以读者看到的是每列"最后写入"的内容——这正是要用缓冲而不是
 * 字符串裁剪的原因：`100%\rOK` 显示 `OK0%`（重绘比底层帧短），末尾 `abc\b` 仍显示
 * `abc`（从没有内容覆盖过 c）。CSI 序列不占列，只改变后续写入打上的状态戳；
 * 最后把各列按状态重发为 run，anser 就能看到同样的样式。
 * @param line - 一行输出，仍带 CSI 序列。
 * @param entrySgr - 行开始时生效的 SGR 状态（换行不会重置状态）。
 * @returns 经过所有光标移动后终端应该显示的行文本，以及行末状态（供下一行进入）。
 */
function replayLine(line: string, entrySgr: SgrState): { text: string; sgr: SgrState } {
  // Same shape anser splits on, so a sequence is one unit here as well.
  // 与 anser 的切分形状一致，一条序列在这里也是一个整体单元。
  const csi = /\u001b\[([\u0030-\u003f]*)[\u0020-\u002f]*([\u0040-\u007e])/g
  /** Per column: the state in force when it was written, and its character. */
  // 列缓冲：每列记录"写入时的状态 + 字符"。
  const columns: (Cell | undefined)[] = []
  // 当前光标列位置（0 起）。
  let cursor = 0
  // State is tracked exactly as a terminal tracks it: each cell is stamped with
  // whatever was in force at the moment of the write, so a later redraw cannot
  // restyle the cells it does not reach. It enters carrying the previous line's
  // state, since a newline does not reset it.
  // 状态与终端一致地按"写入时刻"打戳：后来的重绘无法重排它没碰到的单元格；
  // 进入时带着上一行的状态（换行不重置）。
  let sgr = entrySgr
  // 扫描位置：当前尚未消费的文本起点。
  let at = 0

  /** Clear a cell and, for a wide pair, its partner: a terminal erases both. */
  // 清空一个单元格；若它是宽字符对的一半，连它的另一半一起清（终端总是成对擦除）。
  const clear = (index: number, fill: string): void => {
    const cell = columns[index]
    if (cell?.spacer === true && index > 0) columns[index - 1] = { sgr, char: fill }
    else if (cell !== undefined && isWide(cell.char) && columns[index + 1]?.spacer === true) {
      columns[index + 1] = { sgr, char: fill }
    }
    columns[index] = { sgr, char: fill }
  }

  const consume = (chunk: string): void => {
    for (const char of chunk) {
      if (char === '\r') { cursor = 0; continue }
      if (char === '\u0008') { cursor = Math.max(0, cursor - 1); continue }
      if (char === '\t') {
        // A tab advances to the next 8-column stop, leaving the cells it skips
        // as they were — which is how a redraw can leave a tabbed column
        // standing. Column alignment is the whole point of this card.
        // Tab 前进到下一个 8 列制表位，跳过的格子保持原样——这正是重绘后制表列
        // 还能"站在原位"的原因；列对齐是本卡片存在的意义。
        const stop = cursor + TAB_WIDTH - (cursor % TAB_WIDTH)
        for (; cursor < stop; cursor++) columns[cursor] ??= { sgr, char: ' ' }
        continue
      }
      if (ZERO_WIDTH.test(char)) {
        // No column of its own: it attaches to the cell already written, so a
        // redraw that covers that cell covers the mark with it. With no cell to
        // attach to (line start, or straight after a redraw to column 0) a
        // terminal shows nothing rather than a lone accent.
        // 零宽字符不占列：附着到已写入的单元格上，重绘覆盖该格即覆盖记号；
        // 没有可附着的格子（行首、或刚重绘到第 0 列）时终端什么都不显示。
        const base = cursor > 0 ? columns[cursor - 1] : undefined
        if (base !== undefined) columns[cursor - 1] = { sgr: base.sgr, char: base.char + char }
        continue
      }
      // Writing over either half of a wide pair blanks the other half, since a
      // terminal cannot leave one cell of a two-cell glyph standing.
      // 覆盖宽字符对的任一半都要把另一半清成空白——终端不允许两格字形只剩一格。
      clear(cursor, ' ')
      columns[cursor] = { sgr, char }
      cursor++
      // A wide character occupies two columns; the trailing one is a spacer,
      // marked so that overwriting the lead cell leaves a blank behind instead
      // of closing the gap and shifting everything after it left.
      // 宽字符占两列：尾列是 spacer 标记，覆盖头列时只留空白、不会合拢空隙
      // 把后续所有内容左移。
      if (isWide(char)) { columns[cursor] = { sgr, char: '', spacer: true }; cursor++ }
    }
  }

  for (const match of line.matchAll(csi)) {
    // 逐条消费 CSI 序列：先处理序列之前的普通文本，再处理序列本身。
    consume(line.slice(at, match.index))
    at = match.index + match[0].length
    // Both groups are mandatory in the pattern, so destructuring types them as
    // strings without a fallback that could never run.
    // 正则的两个捕获组都是必选的，因此可以直接解构为 string 而无需兜底。
    const params = String(match[1])
    const final = String(match[2])
    if (final === 'K') {
      // Erase in line: the fixed companion of `\r` in every spinner and progress
      // bar. Without it a shorter redraw leaves the previous frame's tail
      // standing, which is text the terminal never showed. `1` blanks from the
      // line start THROUGH the cursor column (inclusive, per the CSI spec)
      // rather than dropping those cells, since the cursor does not move and a
      // later write can still land past them. Only the FIRST parameter selects
      // the mode; a terminal ignores the rest (`1;2K` erases exactly as `1K`).
      // 清行（K）：每个 spinner / 进度条里 \r 的固定搭档。没有它，较短的重绘会留下
      // 上一帧的尾巴——终端根本没显示过的文字。模式 1 从行首清到光标列（含，按 CSI 规范），
      // 但不删除这些格子（光标不动，后续写入仍可能落到它们后面）；只有第一个参数决定
      // 模式，终端忽略其余参数（1;2K 与 1K 效果相同）。
      const mode = String(params.split(';')[0])
      if (mode === '1') for (let index = 0; index <= cursor; index++) clear(index, ' ')
      else columns.length = mode === '2' ? 0 : cursor
      continue
    }
    // Only SGR carries graphic state; every other final byte is a cursor or
    // erase action that must not affect a cell's style.
    // 只有 SGR（最终字节 m）携带图形状态；其它最终字节都是光标/擦除动作，
    // 不能影响单元格的样式。
    if (final !== 'm') continue
    sgr = foldSgr(sgr, params)
  }
  consume(line.slice(at))

  // Re-emit the columns, opening a run only where its state changes, so anser
  // sees the same styling a terminal shows. Each boundary emits ONE canonical
  // sequence for the state it opens, which is what keeps the output linear in
  // the number of cells however the state was reached.
  // 重发各列：只在状态变化处开启新 run，让 anser 看到与终端一致的样式。
  // 每个边界只输出"开启该状态"的一条规范序列，因此输出规模与单元格数成线性。
  let out = ''
  let active = entrySgr
  for (let index = 0; index < columns.length; index++) {
    const column = columns[index] ?? { sgr: SGR_NONE, char: ' ' }
    if (!sameSgr(column.sgr, active)) {
      if (!sameSgr(active, SGR_NONE)) out += '\u001b[0m'
      out += openSgr(column.sgr)
      active = column.sgr
    }
    // A spacer still holds its column. While its lead cell survives, the wide
    // glyph spans both and the spacer emits nothing; once a later write replaced
    // that lead, the terminal blanks the spacer instead of closing the gap, so
    // emitting nothing would shift everything after it one column left.
    // spacer 仍然占据列：当头列还活着时，宽字形跨两格、spacer 不输出任何字符；
    // 一旦头列被后来的写入替换，终端会把 spacer 空成空白而不是合拢空隙，
    // 否则不输出会让它后面所有内容左移一列。
    const leadIntact = index > 0 && isWide(columns[index - 1]?.char ?? '')
    out += column.spacer === true && !leadIntact ? ' ' : column.char
  }
  // Converge to the state the SCAN ended in, not the last written cell's: a
  // sequence after the final write (the `\x1b[0m` closing a colored line) changes
  // no cell yet still ends the run, and it has to reach both the DOM and the
  // next line. Without this a line ending in a reset leaked its color onward.
  // 收敛到"扫描结束时"的状态而非最后一个写入格的状态：最后写入之后出现的序列
  // （如收尾的 \x1b[0m）不改变任何格，却结束了 run，且必须同时传给 DOM 与下一行；
  // 少了这一步，以复位结尾的行会把颜色泄漏到后面。
  if (!sameSgr(active, sgr)) {
    if (!sameSgr(active, SGR_NONE)) out += '\u001b[0m'
    out += openSgr(sgr)
  }
  return { text: out, sgr }
}

/** One replayed column: the state it was written with, and its character. */
// 回放后的一个列单元：写入时的状态 + 字符。
interface Cell {
  sgr: SgrState
  char: string
  /** The trailing half of a wide character's two-column pair. */
  // 宽字符两列对中的尾半格标记。
  spacer?: boolean
}

/**
 * Replay every line's cursor movements. A `\r` that only terminates a CRLF line
 * is dropped first, so those lines keep their text instead of being redrawn onto
 * themselves. SGR state threads across lines: a newline does not reset it, so a
 * run opened before a redraw still colors the lines after it.
 * @param text - output text, already free of OSC and non-CSI escapes.
 * @returns the text with each line painted as the terminal would.
 */
/*
 * 逐行回放光标移动。仅用于终止 CRLF 行的 \r 先被去掉，否则这些行会把自己重绘到
 * 自己身上。SGR 状态跨行传递：换行不重置状态，所以重绘前开启的 run 仍会着色其后的行。
 * @param text - 已清除 OSC 与非 CSI 转义的输出文本。
 * @returns 每一行都按终端方式绘制后的文本。
 */
function applyCursorMovements(text: string): string {
  const replayed: string[] = []
  let sgr = SGR_NONE
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r+$/, '')
    if (NEEDS_REPLAY.test(line)) {
      const result = replayLine(line, sgr)
      replayed.push(result.text)
      sgr = result.sgr
      continue
    }
    // No cursor movement: the line needs no column buffer, and painting one
    // would allocate a cell per character of output this card never redraws —
    // an `ls -R` or a 5k-line log. Only its own SGR has to be folded, so a later
    // line that DOES replay enters with the right state.
    // 没有光标移动的行不需要列缓冲——为不重绘的输出（如 ls -R 或 5000 行日志）
    // 按字符分配单元格纯属浪费；只需折叠它自己的 SGR，让后面真正需要回放的行
    // 带着正确的状态进入。
    replayed.push(line)
    for (const match of line.matchAll(SGR_SEQUENCE)) sgr = foldSgr(sgr, String(match[1]))
  }
  return replayed.join('\n')
}

/**
 * Remove every escape sequence and control character that carries no color,
 * leaving CSI sequences for anser and `\n`/`\t` for layout. Cursor movements
 * (carriage return, backspace) replay first, since their effect on the visible
 * text must land before the characters that expressed them are dropped.
 * @param text - raw command output.
 * @returns text whose only remaining escapes are CSI sequences.
 */
/*
 * 清除所有不携带颜色的转义序列与控制字符，只给 anser 留 CSI 序列、给布局留 \n 与 \t。
 * 光标移动（回车、退格）必须先回放：它们对可见文本的影响必须落在表达它们的字符被
 * 删除之前。
 * @param text - 原始命令输出。
 * @returns 仅剩 CSI 序列的文本。
 */
function sanitize(text: string): string {
  const escaped = text.replace(OSC_SEQUENCE, '').replace(NON_CSI_ESCAPE, '')
  return applyCursorMovements(escaped).replace(INERT_CONTROL, '')
}

/**
 * Resolve one run's colors and decorations.
 * @param chunk - the anser chunk to style.
 * @returns the run's inline style, or undefined when it carries no SGR state.
 */
/*
 * 解析一个 run 的颜色与装饰。
 * @param chunk - 要样式化的 anser 片段。
 * @returns 该 run 的内联样式；没有任何 SGR 状态时返回 undefined。
 */
function resolveStyle(chunk: AnsiChunk): CSSProperties | undefined {
  const style: CSSProperties = {}
  const background = chunk.bg === null ? undefined : `rgb(${chunk.bg})`
  if (background !== undefined) style.backgroundColor = background
  if (chunk.fg !== null) {
    const literal = `rgb(${chunk.fg})`
    // A run that paints its own background keeps anser's literal pair so the
    // authored foreground/background contrast survives; a foreground-only run
    // maps onto a theme token, which adapts to light and dark surfaces.
    // 自带背景色的 run 保留 anser 的字面颜色对，保住作者写下的前后景对比；
    // 只有前景的 run 才映射到主题 token，从而适配浅色/深色表面。
    style.color = background === undefined
      ? TOKEN_BY_BASIC_RGB[chunk.fg.replace(/\s+/g, '')] ?? literal
      : literal
  }
  for (const decoration of chunk.decorations) Object.assign(style, STYLE_BY_DECORATION[decoration])
  return Object.keys(style).length === 0 ? undefined : style
}

/**
 * Parse command output into styled spans grouped by line.
 * @param text - raw output text, which may contain ANSI escape sequences.
 * @returns one entry per output line (always at least one, possibly empty).
 */
/*
 * 把命令输出解析成"按行分组的带样式 span"——TerminalBlock 的直接输入。
 * 使用示例：parseAnsiLines(rawOutput).map((line, i) => <div key={i}>{line.map(renderSpan)}</div>)。
 * @param text - 原始输出文本，可能含 ANSI 转义序列。
 * @returns 每个输出行一个条目（始终至少一行，可能为空行）。
 */
export function parseAnsiLines(text: string): AnsiLine[] {
  let current: AnsiSpan[] = []
  const lines: AnsiSpan[][] = [current]
  for (const chunk of Anser.ansiToJson(sanitize(text), { json: true, remove_empty: true })) {
    const style = resolveStyle(chunk)
    // run 内的换行会被切进新行：换行符前的部分属于当前行，之后另起一行。
    for (const [index, part] of chunk.content.split('\n').entries()) {
      if (index > 0) {
        current = []
        lines.push(current)
      }
      if (part !== '') current.push({ text: part, style })
    }
  }
  return lines
}
