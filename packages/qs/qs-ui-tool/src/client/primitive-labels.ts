/**
 * 官方 primitives 的本地化 chrome 组装。
 *
 * 官方 `ui-primitives` 是共享模块表行：样式与结构归它，文案归调用方。这里把本包字典
 * 映射成各 primitives 需要的标签对象，函数型标签在组件渲染时按参数调用。
 */
import type {
  DiffBlockLabels, ReadBlockLabels, SearchBlockLabels, TerminalBlockLabels, WebBlockLabels,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

/** 本包翻译座席类型。 */
type T = TranslateNS<'qs-ui-tool'>

/**
 * 终端块的标签。
 * @param t - 翻译座席。
 * @returns 终端块标签。
 */
export function terminalLabels(t: T): TerminalBlockLabels {
  return {
    signal: signal => t('terminal.signal', { signal }),
    exitCode: code => t('terminal.exitCode', { exitCode: code }),
    running: t('terminal.running'),
    failed: t('terminal.failed'),
    done: t('terminal.done'),
    copy: t('terminal.copy'),
    copied: t('terminal.copied'),
    noOutput: t('terminal.noOutput'),
    collapseAria: t('terminal.collapseAria'),
    collapse: t('terminal.collapse'),
    expandAria: hidden => t('terminal.expandAria', { hidden }),
    expand: hidden => t('terminal.expand', { hidden }),
  }
}

/**
 * 读取块的标签。
 * @param t - 翻译座席。
 * @returns 读取块标签。
 */
export function readLabels(t: T): ReadBlockLabels {
  return {
    window: (shown, total) => t('read.window', { shown, total }),
    copy: t('read.copy'),
    copied: t('read.copied'),
    collapseAria: t('read.collapseAria'),
    collapse: t('read.collapse'),
    expandAria: hidden => t('read.expandAria', { hidden }),
    expand: hidden => t('read.expand', { hidden }),
  }
}

/**
 * 差异块的标签。
 * @param t - 翻译座席。
 * @returns 差异块标签。
 */
export function diffLabels(t: T): DiffBlockLabels {
  return {
    copy: t('diff.copy'),
    copied: t('diff.copied'),
    files: count => t('diff.files', { count }),
    collapseAria: t('diff.collapseAria'),
    collapse: t('diff.collapse'),
    expandAria: hidden => t('diff.expandAria', { hidden }),
    expand: hidden => t('diff.expand', { hidden }),
  }
}

/**
 * 搜索块的标签。
 * @param t - 翻译座席。
 * @returns 搜索块标签。
 */
export function searchLabels(t: T): SearchBlockLabels {
  return {
    pathsSummary: (shown, total, truncated) => (truncated
      ? t('search.pathsTruncated', { shown, total })
      : t('search.paths', { shown })),
    matchesSummary: (shown, total, files, truncated) => (truncated
      ? t('search.matchesTruncated', { shown, total, files })
      : t('search.matches', { shown, files })),
    copy: t('search.copy'),
    copied: t('search.copied'),
    noResults: t('search.noResults'),
    collapseAria: t('search.collapseAria'),
    collapse: t('search.collapse'),
    expandAria: hidden => t('search.expandAria', { hidden }),
    expand: hidden => t('search.expand', { hidden }),
  }
}

/**
 * Web 块的标签。
 * @param t - 翻译座席。
 * @returns Web 块标签。
 */
export function webLabels(t: T): WebBlockLabels {
  return {
    noResults: t('web.noResults'),
    sourcesTruncated: t('web.sourcesTruncated'),
    http: t('web.http'),
    contentTruncated: t('web.contentTruncated'),
    markdown: {
      code: { copyLabel: t('markdown.copy'), copiedLabel: t('markdown.copied') },
      footnotes: t('markdown.footnotes'),
    },
  }
}
