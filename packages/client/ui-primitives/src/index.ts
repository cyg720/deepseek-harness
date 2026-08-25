/*
 * ================================ 文件注释 ================================
 * 【文件职责】ui-primitives 包的公共导出桶：统一暴露所有基础 UI 组件、Hook 与工具函数。
 * 【技术维度】纯 re-export，无任何实现逻辑；类型用 `export type` 单独导出。
 * 【产品维度】其它 client 包从这里按需引用按钮、菜单、代码块、剪贴板等基础件。
 * 【逻辑维度】按组件、Hook、工具、markdown 渲染器、图标依次分组导出。
 * 【关键边界】不新增实现；此处即本包的公共 API 面。
 * 【新手阅读建议】把它当作"本包有什么"的目录来读。
 * ==========================================================================
 */
/**
 * Cordis-free React primitives styled only through `--dsw-*` tokens.
 */

export { StateDot } from './StateDot.tsx'
export type { StateDotState } from './StateDot.tsx'
export { DisclosureRow } from './DisclosureRow.tsx'
export type { DisclosureRowProps } from './DisclosureRow.tsx'
export { Button } from './Button.tsx'
export type { ButtonVariant } from './Button.tsx'
export { Pill } from './Pill.tsx'
export { Input } from './Input.tsx'
export { Menu } from './Menu.tsx'
export type { MenuEntry, MenuItem, MenuSeparator, MenuLabel } from './Menu.tsx'
export { useAnchoredMaxHeight } from './useAnchoredMaxHeight.ts'
export { useAnchoredPosition } from './useAnchoredPosition.ts'
export type { AnchoredPositionOptions } from './useAnchoredPosition.ts'
export { useDismissOnOutsidePointer } from './useDismissOnOutsidePointer.ts'
export { HoverCard } from './HoverCard.tsx'
export { Modal } from './Modal.tsx'
export { OnboardingSurface } from './OnboardingSurface.tsx'
export { RiskConfirmation } from './RiskConfirmation.tsx'
export type { RiskConfirmationProps } from './RiskConfirmation.tsx'
export { ConnectionBanner } from './ConnectionBanner.tsx'
export { FishLogo } from './FishLogo.tsx'
export { BrandWordmark } from './BrandWordmark.tsx'
export type { BrandWordmarkProps } from './BrandWordmark.tsx'
export { Tooltip } from './Tooltip.tsx'
export type { TooltipSide } from './Tooltip.tsx'
export { Toast } from './Toast.tsx'
export { writeClipboard } from './clipboard.ts'
export { JsonTree } from './JsonTree.tsx'
export type { JsonTreeProps, JsonTreeLabels } from './JsonTree.tsx'
export { TerminalBlock, DEFAULT_TERMINAL_MAX_LINES } from './TerminalBlock.tsx'
export type { TerminalBlockProps, TerminalBlockLabels } from './TerminalBlock.tsx'
export { ReadBlock, DEFAULT_READ_MAX_LINES } from './ReadBlock.tsx'
export type { ReadBlockProps, ReadBlockLine } from './ReadBlock.tsx'
export { DiffBlock, DEFAULT_DIFF_MAX_LINES } from './DiffBlock.tsx'
export type { DiffBlockProps, DiffHunk } from './DiffBlock.tsx'
export { SearchBlock, DEFAULT_SEARCH_MAX_LINES } from './SearchBlock.tsx'
export type {
  SearchBlockProps, SearchMatchesBlockProps, SearchPathsBlockProps, SearchFileGroup, SearchBlockLineMatch,
} from './SearchBlock.tsx'
export { WebBlock } from './WebBlock.tsx'
export type { WebBlockProps, WebSearchBlockProps, WebFetchBlockProps, WebSourceView } from './WebBlock.tsx'
export { CodeBlock } from './markdown/CodeBlock.tsx'
export type { CodeBlockProps } from './markdown/CodeBlock.tsx'
export { JsonBlock } from './markdown/JsonBlock.tsx'
export { MarkdownText } from './markdown/MarkdownText.tsx'
export type { MarkdownCodeLabels, MarkdownFileMentions } from './markdown/MarkdownText.tsx'
export { MessageText } from './markdown/MessageText.tsx'
export { extractMarkdownPlainText } from './markdown/plain-text.ts'
export type { MarkdownPlainTextMode, MarkdownPlainTextOptions } from './markdown/plain-text.ts'
export * from './icons/index.tsx'
