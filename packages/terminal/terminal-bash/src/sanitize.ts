/** Streaming terminal-control sanitizer for the line-oriented first release. */
/*
 * ================================ 文件注释 ================================
 * 【文件职责】面向行导向首版的流式终端控制净化器：从 PTY 输出里剥离 CSI/OSC/短转义
 * 序列，同时识别受控 bash 在每次提示符前发出的私有 OSC 标记（133;D;），保留标记后
 * 的可打印提示尾部，供就绪判断使用。
 * 【技术维度】流式状态机：跨块保留半截转义序列（pending 缓冲）、discardMode 丢弃模式、
 * 尾随回车暂存、promptTail 跟踪；上限内无完整终端仿真（刻意延后），普通行输出与
 * 私有提示符标记是受支持契约。
 * 【产品维度】持久化终端会话的"干净文本"来源：模型看到的输出不含控制序列，且能
 * 可靠判定"shell 已回到提示符"（就绪/完成信号）。
 * 【逻辑维度】push 按块处理（丢前缀 → 扫 ESC → OSC/CSI/短序列分类与终结 → 尾随
 * 片段保留）→ flush 收尾 → normalizeText/normalizeTerminalText 归一化 CRLF/BEL。
 * 【关键边界】OSC 以 BEL 或 ST（ESC\）终结；CSI 以 0x40-0x7E 终结；跨块边界必须
 * 保留半截序列；pending 超限时进入丢弃模式并清空。
 * 【新手阅读建议】先看 push 的主循环（ESC 处理三族），再看 discardPrefix 的跨块恢复，
 * 最后看 promptTail 的跟踪逻辑（与就绪判断联动）。
 * ==========================================================================
 */

import { Buffer } from 'node:buffer'

/** OSC marker emitted by the controlled bash before each prompt. */
/* 受控 bash 在每次提示符前发出的 OSC 标记前缀。 */
export const PROMPT_MARKER_PREFIX = '133;D;'

/** Exact printable prompt emitted after the private marker. */
/* 私有标记之后发出的确切可打印提示符。 */
export const CONTROLLED_PROMPT = 'dsh> '

/** One sanitized chunk plus whether it contained the owned prompt marker. */
/* 一个已净化块，外加它是否包含自有提示符标记。 */
export interface SanitizedChunk {
  text: string
  prompt: boolean
  /** Printable text after the latest owned marker in this chunk. */
  /* 本块中最新的自有标记之后的可打印文本。 */
  promptTail?: string
}

/**
 * Remove CSI/OSC/short escape sequences while preserving split-sequence carry.
 * Full terminal emulation is deliberately deferred; ordinary line output and
 * the private prompt marker are the supported contract.
 */
/*
 * 去除 CSI/OSC/短转义序列，同时保留跨块切分的序列状态。完整终端仿真刻意延后；
 * 普通行输出与私有提示符标记是受支持契约。
 */
export class TerminalSanitizer {
  private pending = ''
  private discardMode: 'osc' | 'csi' | undefined
  private discardOscEscape = false
  private trailingCarriageReturn = false
  private trackingPromptTail = false

  constructor(private readonly maxPendingBytes: number) {}

  /**
   * Consume one decoded `node-pty` data chunk.
   * @param chunk - decoded terminal data.
   * @returns Printable text and whether the private prompt marker completed.
   */
  /*
   * 消费一个解码后的 node-pty 数据块。
   * @param chunk 解码后的终端数据
   * @returns 可打印文本与私有提示符标记是否完成
   */
  push(chunk: string): SanitizedChunk {
    this.pending += this.discardPrefix(chunk)
    let text = ''
    let prompt = false
    let includePromptTail = this.trackingPromptTail
    let promptTail = ''
    let index = 0
    const appendText = (value: string): void => {
      text += value
      if (this.trackingPromptTail) promptTail += value
    }
    while (index < this.pending.length) {
      const escape = this.pending.indexOf('\x1b', index)
      if (escape < 0) {
        // 无转义：剩余全部是普通文本。
        appendText(this.pending.slice(index))
        index = this.pending.length
        break
      }
      appendText(this.pending.slice(index, escape))
      if (escape + 1 >= this.pending.length) {
        // ESC 在块尾：保留到下一块。
        index = escape
        break
      }
      const kind = this.pending[escape + 1]
      if (kind === ']') {
        // OSC 序列：以 BEL 或 ST（ESC\）终结；找不到终结符则保留到下一块。
        const bel = this.pending.indexOf('\x07', escape + 2)
        const stringTerminator = this.pending.indexOf('\x1b\\', escape + 2)
        let end = -1
        if (bel >= 0 && stringTerminator >= 0) end = Math.min(bel + 1, stringTerminator + 2)
        else if (bel >= 0) end = bel + 1
        else if (stringTerminator >= 0) end = stringTerminator + 2
        if (end < 0) {
          index = escape
          break
        }
        const terminatorBytes = this.pending[end - 1] === '\x07' ? 1 : 2
        const content = this.pending.slice(escape + 2, end - terminatorBytes)
        // 命中私有提示符标记：置 prompt 标志并开始跟踪标记后的提示尾部。
        if (content.startsWith(PROMPT_MARKER_PREFIX)) {
          prompt = true
          this.trackingPromptTail = true
          includePromptTail = true
          promptTail = ''
        }
        index = end
        continue
      }
      if (kind === '[') {
        // CSI 序列：扫描到终结字节（0x40-0x7E）；未终结则保留到下一块。
        let end = escape + 2
        while (end < this.pending.length) {
          const code = this.pending.charCodeAt(end)
          if (code >= 0x40 && code <= 0x7e) break
          end += 1
        }
        if (end >= this.pending.length) {
          index = escape
          break
        }
        index = end + 1
        continue
      }
      // Two-byte escape family (save/restore cursor and similar).
      // 双字节转义族（保存/恢复光标等）。
      index = escape + 2
    }
    this.pending = this.pending.slice(index)
    this.enforcePendingBound()
    return {
      text: this.normalizeText(text),
      prompt,
      ...includePromptTail ? { promptTail } : {},
    }
  }

  /**
   * Flush a trailing printable fragment when the PTY exits.
   * @returns Remaining printable text; incomplete escapes are discarded.
   */
  /*
   * PTY 退出时冲刷残留的可打印片段。
   * @returns 剩余可打印文本；不完整转义被丢弃。
   */
  flush(): string {
    const text = this.pending.startsWith('\x1b') ? '' : this.pending
    this.pending = ''
    this.discardMode = undefined
    this.discardOscEscape = false
    this.trackingPromptTail = false
    const normalized = this.normalizeText(text)
    if (!this.trailingCarriageReturn) return normalized
    this.trailingCarriageReturn = false
    return `${normalized}\n`
  }

  /** 归一化文本并暂存尾部孤立的 \r（跨块保留其换行语义）。 */
  private normalizeText(text: string): string {
    let complete = this.trailingCarriageReturn ? `\r${text}` : text
    this.trailingCarriageReturn = false
    if (complete.endsWith('\r')) {
      complete = complete.slice(0, -1)
      this.trailingCarriageReturn = true
    }
    return normalizeTerminalText(complete)
  }

  /** pending 超限：进入丢弃模式并清空（下块起从 discardPrefix 恢复）。 */
  private enforcePendingBound(): void {
    if (Buffer.byteLength(this.pending) <= this.maxPendingBytes) return
    this.discardMode = this.pending[1] === ']' ? 'osc' : 'csi'
    this.pending = ''
  }

  /** 丢弃正在进行的 OSC/CSI 序列的剩余部分，返回其后新块的开头。 */
  private discardPrefix(chunk: string): string {
    if (this.discardMode === undefined) return chunk
    if (this.discardMode === 'csi') {
      for (let index = 0; index < chunk.length; index += 1) {
        const code = chunk.charCodeAt(index)
        if (code >= 0x40 && code <= 0x7e) {
          this.discardMode = undefined
          return chunk.slice(index + 1)
        }
      }
      return ''
    }

    let index = 0
    // 上一块以 ESC 结尾且可能是 ST 开头：检查本块是否以 \ 继续。
    if (this.discardOscEscape) {
      this.discardOscEscape = false
      if (chunk.startsWith('\\')) {
        this.discardMode = undefined
        return chunk.slice(1)
      }
    }
    while (index < chunk.length) {
      if (chunk[index] === '\x07') {
        this.discardMode = undefined
        return chunk.slice(index + 1)
      }
      if (chunk[index] === '\x1b') {
        if (chunk[index + 1] === '\\') {
          this.discardMode = undefined
          return chunk.slice(index + 2)
        }
        if (index + 1 === chunk.length) this.discardOscEscape = true
      }
      index += 1
    }
    return ''
  }
}

/**
 * Normalize CRLF and standalone carriage returns for line-oriented rendering.
 * @param text - sanitized terminal text.
 * @returns Line-normalized text with BEL removed.
 */
/*
 * 为行导向渲染归一化 CRLF 与独立回车。
 * @param text 已净化的终端文本
 * @returns 行归一化且去除 BEL 的文本
 */
export function normalizeTerminalText(text: string): string {
  return text.replaceAll('\r\n', '\n').replaceAll('\r', '\n').replaceAll('\x07', '')
}
