/*
 * ================================ 文件注释 ================================
 * 【文件职责】提供"固定密度"的启发式 token 定价，供 meter 服务与纯上下文
 * 构成投影共享——两条展示面把相同内容定价为相同数字。
 * 【技术维度】固定假设：每 4 个字符约 1 token（CHARS_PER_TOKEN），每个块加
 * 固定结构开销（BLOCK_OVERHEAD），每条消息加角色框架开销（ROLE_OVERHEAD）；
 * 递归定价内容块，未知块类型按 JSON 序列化长度保守定价。
 * 【产品维度】在精确 token 化成本过高/不可用（无 tokenizer）时，给出确定、
 * 稳定、可复现的近似值，供占用展示与预算规划；系统性地低估 CJK 文本与
 * JSON schema，因此只作近似不作计费。
 * 【逻辑维度】常量 → estimateContent（递归定价块）→ estimateMessage →
 * 包络三件套（system/tools/header）。
 * 【关键边界】启发式只依赖文本长度与结构，与具体模型无关；ContentBlockMap
 * 可扩展，未知块有保守兜底定价。
 * 【新手阅读建议】先看三个常量理解定价假设，再读 estimateContent 的递归。
 * ==========================================================================
 */

/**
 * Fixed-density heuristic token pricing shared by the meter service and the
 * pure context-breakdown projection, so both surfaces price identical content
 * to identical numbers.
 *
 * @module @deepseek-ai/dsh-token-meter/estimate
 */

import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'
import type { EpochHeader } from '@deepseek-ai/dsh-session'

/** Fixed text-density estimate used until exact tokenization is needed. */
// 中文：在需要精确分词之前使用的固定文本密度估计（每 4 字符约 1 token）。
const CHARS_PER_TOKEN = 4

/** Per-block structural overhead for JSON framing and type tags. */
// 中文：每个块的 JSON 框架与类型标签结构开销。
const BLOCK_OVERHEAD = 4

/** Role-field framing overhead added to every priced message. */
// 中文：每条被定价消息追加的角色字段框架开销（导出供外部核对）。
export const ROLE_OVERHEAD = 4

/*
 * （中文）在固定密度启发式下递归定价内容块。
 * @param blocks 要定价的内容块（不改写）。
 * @returns 启发式 token 数（含每块结构开销）。
 */
/**
 * Structural JSON price of one block outside the typed pricing arms: the
 * fixed heuristic for merge-extended blocks and for image references, whose
 * request price is route-owned rather than fixed.
 * @param block - block to price without mutation.
 * @returns heuristic tokens for the block's JSON structure.
 */
export function estimateStructuralBlock(block: ContentBlock): number {
  return BLOCK_OVERHEAD + Math.ceil(JSON.stringify(block).length / CHARS_PER_TOKEN)
}

/**
 * Price content blocks recursively under the fixed density heuristic.
 * @param blocks - content blocks to price without mutation.
 * @returns heuristic tokens including per-block structural overhead.
 */
export function estimateContent(blocks: readonly ContentBlock[]): number {
  let tokens = 0
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
      case 'reasoning':
        tokens += Math.ceil(block.text.length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD
        break
      case 'tool-call':
        tokens += Math.ceil(block.name.length / CHARS_PER_TOKEN)
          + Math.ceil(block.arguments.length / CHARS_PER_TOKEN)
          + BLOCK_OVERHEAD
        break
      case 'tool-result':
        tokens += estimateContent(block.content) + BLOCK_OVERHEAD
        break
      default:
        // ContentBlockMap is merge-extensible; unknown blocks (and image
        // references, whose request price is route-owned) retain a
        // conservative structural JSON price under the fixed heuristic.
        tokens += estimateStructuralBlock(block)
    }
  }
  return tokens
}

/*
 * （中文）启发式定价一条模型可见消息。
 * @param message 要定价的消息（不改写）。
 * @returns 固定启发式下的内容 + 角色框架 token 数。
 */
/**
 * Heuristically price one model-visible message.
 * @param message - message to price without mutation.
 * @returns content and role-framing tokens under the fixed heuristic.
 */
export function estimateMessage(message: Message): number {
  return estimateContent(message.content) + ROLE_OVERHEAD
}

/*
 * （中文）定价规范请求包络的"系统提示"部分。
 * @param header 规范包络，或任何请求之前为 undefined。
 * @returns 启发式系统提示 token 数；缺席时为 0。
 */
/**
 * Price the system-prompt part of a canonical request envelope.
 * @param header - canonical envelope, or undefined before any request.
 * @returns heuristic system-prompt tokens; 0 when absent.
 */
export function estimateSystemTokens(header: EpochHeader | undefined): number {
  if (header?.system === undefined) return 0
  return Math.ceil(header.system.length / CHARS_PER_TOKEN) + ROLE_OVERHEAD
}

/*
 * （中文）定价规范请求包络的"工具 schema"部分。
 * @param header 规范包络，或任何请求之前为 undefined。
 * @returns 启发式工具 schema token 数；缺席或为空时为 0。
 */
/**
 * Price the tool-schema part of a canonical request envelope.
 * @param header - canonical envelope, or undefined before any request.
 * @returns heuristic tool-schema tokens; 0 when absent or empty.
 */
export function estimateToolsTokens(header: EpochHeader | undefined): number {
  if (header?.tools === undefined || header.tools.length === 0) return 0
  return Math.ceil(JSON.stringify(header.tools).length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD
}

/*
 * （中文）定价完整的"非表面"请求包络。
 * @param header 规范包络，或任何请求之前为 undefined。
 * @returns 启发式的系统 + 工具 token 数。
 */
/**
 * Price the complete non-surface request envelope.
 * @param header - canonical envelope, or undefined before any request.
 * @returns heuristic system plus tool tokens.
 */
export function estimateHeader(header: EpochHeader | undefined): number {
  return estimateSystemTokens(header) + estimateToolsTokens(header)
}
