/**
 * Meta validation checks caller-provided DATA against the {@link WorkflowMeta}
 * contract and rejects every violation by name. Meta arrives as schema-checked
 * JSON data, never evaluated script text; evaluating it on the host could run getters outside the
 * worker timeout that exists to isolate model-written code.
 * @module @deepseek-ai/dsh-workflow-worker-thread/meta
 */
/**
 * 文件职责：实现 meta.ts 覆盖的工作流与 Worker Thread行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、Worker Thread、消息协议或领域实体。
 * 产品维度：保障 Agent 的工作流与 Worker Thread能力稳定、可隔离且可诊断。
 * 逻辑维度：准备配置和消息，建立运行环境，执行流程，再处理事件、错误与清理。
 * 关键边界：线程消息不可信；跨线程状态必须显式传递；终止时必须等待所拥有资源停止。
 * 新手阅读建议：先看协议和类型，再读 Host/Runtime 主流程，最后关注隔离、失败与清理。
 */

import { WorkflowError } from '@deepseek-ai/dsh-workflow'
import type { WorkflowMeta, WorkflowPhase } from '@deepseek-ai/dsh-workflow'

/** Collect shape violations for a meta value (plain JSON data by the seam contract). */
/** 中文说明：函数 validateMetaShape 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function validateMetaShape(meta: unknown): { meta?: WorkflowMeta; violations: string[] } {
  /** 中文说明：变量 violations 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const violations: string[] = []
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) {
    return { violations: ['meta must be an object'] }
  }
  /** 中文说明：变量 record 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const record = meta as Record<string, unknown>
  /** 中文说明：变量 known 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const known = new Set(['name', 'description', 'whenToUse', 'phases'])
  /** 中文说明：该循环依次处理消息或实体；循环变量仅在当前循环中有效。 */
  for (const key of Object.keys(record)) {
    if (!known.has(key)) violations.push(`meta.${key} is not a recognized field (name/description/whenToUse/phases)`)
  }
  if (typeof record.name !== 'string' || record.name.length === 0) violations.push('meta.name must be a non-empty string')
  if (typeof record.description !== 'string' || record.description.length === 0) violations.push('meta.description must be a non-empty string')
  if (record.whenToUse !== undefined && typeof record.whenToUse !== 'string') violations.push('meta.whenToUse must be a string')
  /** 中文说明：变量 phases 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const phases: WorkflowPhase[] = []
  if (record.phases !== undefined) {
    if (!Array.isArray(record.phases)) {
      violations.push('meta.phases must be an array')
    } else {
      record.phases.forEach((phase, index) => {
        if (typeof phase !== 'object' || phase === null || Array.isArray(phase)) {
          violations.push(`meta.phases[${index}] must be an object`)
          return
        }
        /** 中文说明：变量 entry 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const entry = phase as Record<string, unknown>
        /** 中文说明：该循环依次处理消息或实体；循环变量仅在当前循环中有效。 */
        for (const key of Object.keys(entry)) {
          if (!['title', 'detail', 'provider', 'model'].includes(key)) violations.push(`meta.phases[${index}].${key} is not a recognized field`)
        }
        if (typeof entry.title !== 'string' || entry.title.length === 0) violations.push(`meta.phases[${index}].title must be a non-empty string`)
        if (entry.detail !== undefined && typeof entry.detail !== 'string') violations.push(`meta.phases[${index}].detail must be a string`)
        if (entry.provider !== undefined && typeof entry.provider !== 'string') violations.push(`meta.phases[${index}].provider must be a string`)
        if (entry.model !== undefined && typeof entry.model !== 'string') violations.push(`meta.phases[${index}].model must be a string`)
        if (violations.length === 0) {
          phases.push({
            title: entry.title as string,
            ...entry.detail !== undefined ? { detail: entry.detail as string } : {},
            ...entry.provider !== undefined ? { provider: entry.provider as string } : {},
            ...entry.model !== undefined ? { model: entry.model as string } : {},
          })
        }
      })
    }
  }
  if (violations.length > 0) return { violations }
  return {
    violations,
    meta: {
      name: record.name as string,
      description: record.description as string,
      ...record.whenToUse !== undefined ? { whenToUse: record.whenToUse as string } : {},
      ...record.phases !== undefined ? { phases } : {},
    },
  }
}

/**
 * Validate a caller-provided meta value against the {@link WorkflowMeta}
 * contract. Throws `META_INVALID` naming every violation (unknown fields,
 * missing/mistyped `name`/`description`, malformed `phases`); the returned
 * meta is a NORMALIZED copy built from the validated fields, so the engine
 * never aliases the caller's object.
 * @param value - the meta data from the start request (plain JSON by the seam contract).
 * @returns the validated, normalized meta block.
 */
/** 中文说明：函数 validateMeta 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function validateMeta(value: unknown): WorkflowMeta {
  const { meta, violations } = validateMetaShape(value)
  if (meta === undefined) {
    throw new WorkflowError(`invalid meta: ${violations.join('; ')}`, 'META_INVALID')
  }
  return meta
}
