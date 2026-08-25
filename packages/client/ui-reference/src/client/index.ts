/**
 * Unified Web `@` reference source. File and session discovery run through
 * the cancellable generated Remote namespaces in parallel with deterministic
 * ordering and labels.
 *
 * @module @deepseek-ai/dsh-client-ui-reference/client
 */
/**
 * 文件职责：实现客户端统一引用搜索的数据来源（index.ts）。
 * 技术维度：TypeScript、并行异步查询、取消信号与生成的 Remote API。
 * 产品维度：让用户能在输入框中快速引用文件和会话。
 * 逻辑维度：并行查询远端来源，统一排序并映射为引用项。
 * 关键边界：请求可取消，结果排序必须稳定，客户端不得直接依赖 Host 实现。
 * 新手阅读建议：先看导出入口，再看查询合并，最后看标签和排序规则。
 */
// Type-only: pulls the generated Remote API and ctx.remote merge through the Client assembly boundary.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ClientSessionContext, InputTriggerServiceContract, InputTriggerSource,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { formatFileMention } from '@deepseek-ai/dsh-file-reference/grammar'
import type { FileReferenceCandidate } from '@deepseek-ai/dsh-file-reference/types'
import type { SessionReferenceMentionCandidate } from '@deepseek-ai/dsh-session-reference/types'
import { en, NS, zh, type ReferenceKey } from './locales.ts'

/** Required services: the trigger registry, the Remote namespaces, and the copy. */
/** 中文说明：变量 inject 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
export const inject = [
  'inputTriggers', 'locale', 'remote', 'remote.fileReferences', 'remote.sessionReferenceResolver',
]

/**
 * Register the combined `@file` / `@session` source.
 * @param ctx - client root context.
 */
/** 中文说明：函数 apply 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-reference: dictionaries')
  /** 中文说明：变量 t 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const t = ctx.locale.bind(NS)
  /** 中文说明：变量 source 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const source: InputTriggerSource = {
    trigger: '@',
    name: 'reference',
    showGroupTitle: false,
    async candidates(session: ClientSessionContext, { query, quoted, signal }) {
      /** 中文说明：变量 files 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const files = ctx.remote.fileReferences.list(session.sessionId, query, signal).then(
        result => result.ok ? result.value : [],
        () => [],
      )
      /** 中文说明：变量 sessions 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const sessions = quoted === true
        ? Promise.resolve([] as SessionReferenceMentionCandidate[])
        : ctx.remote.sessionReferenceResolver.candidates(session.sessionId, query, signal).then(
          result => result.ok ? result.value : [],
          () => [],
        )
      const [fileItems, sessionItems] = await Promise.all([files, sessions])
      if (signal.aborted) return []
      return [
        ...fileItems.flatMap(candidate => fileCandidate(candidate, quoted === true, t)),
        ...sessionItems.map(candidate => sessionCandidate(candidate, t)),
      ]
    },
    onPick({ candidate }) {
      /** 中文说明：变量 value 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const value = parseCandidate(candidate.value)
      if (value?.kind === 'file') {
        return value.fileKind === 'directory'
          ? { text: value.mention, continue: true }
          : {
            insert: {
              source: 'reference',
              ref: value.mention,
              label: value.label,
              appearance: 'file',
              clipboardText: value.mention,
            },
          }
      }
      if (value?.kind === 'session') {
        return {
          insert: {
            source: 'reference',
            ref: value.mention,
            label: value.label,
            appearance: 'session',
            clipboardText: value.mention,
          },
        }
      }
      return undefined
    },
    codec: {
      clipboardText: ref => ref,
      serialize: ref => Promise.resolve(ref),
    },
  }
  /** 中文说明：变量 inputTriggers 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const inputTriggers = ctx.get('inputTriggers') as InputTriggerServiceContract
  ctx.effect(() => inputTriggers.registerSource(source), 'ui-reference: @ source')
}

/** 中文说明：type Translate 定义本模块所需的数据或行为，用于表达当前功能场景。 */
type Translate = (key: ReferenceKey) => string

/** 中文说明：type ReferenceCandidateValue 定义本模块所需的数据或行为，用于表达当前功能场景。 */
type ReferenceCandidateValue =
  | { kind: 'file'; fileKind: FileReferenceCandidate['kind']; label: string; mention: string }
  | { kind: 'session'; label: string; mention: string }

/** 中文说明：函数 fileCandidate 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function fileCandidate(candidate: FileReferenceCandidate, preserveQuote: boolean, t: Translate) {
  /** 中文说明：变量 mention 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const mention = formatFileMention(candidate, preserveQuote)
  if (mention === undefined) return []
  /** 中文说明：变量 name 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const name = candidate.path.slice(candidate.path.lastIndexOf('/') + 1)
  /** 中文说明：变量 directory 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const directory = candidate.kind === 'directory'
  /** 中文说明：变量 value 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const value: ReferenceCandidateValue = {
    kind: 'file',
    fileKind: candidate.kind,
    label: name,
    mention,
  }
  return [{
    name: `${t(directory ? 'candidate.folder' : 'candidate.file')} · ${name}${directory ? '/' : ''}`,
    description: candidate.path,
    section: t('section.files'),
    value: JSON.stringify(value),
  }]
}

/** 中文说明：函数 sessionCandidate 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function sessionCandidate(candidate: SessionReferenceMentionCandidate, t: Translate) {
  /** 中文说明：变量 location 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const location = candidate.cwd ?? t('candidate.noCwd')
  /** 中文说明：变量 description 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const description = `${candidate.label === candidate.sessionId ? '' : `${candidate.sessionId} · `}${location} · ${new Date(candidate.createdAt).toISOString()}`
  /** 中文说明：变量 value 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const value: ReferenceCandidateValue = {
    kind: 'session',
    label: candidate.label,
    mention: candidate.mention,
  }
  return {
    name: `${t('candidate.session')} · ${candidate.label}`,
    description,
    section: t('section.sessions'),
    value: JSON.stringify(value),
  }
}

/** 中文说明：函数 parseCandidate 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function parseCandidate(value: string | undefined): ReferenceCandidateValue | undefined {
  if (value === undefined) return undefined
  return JSON.parse(value) as ReferenceCandidateValue
}
