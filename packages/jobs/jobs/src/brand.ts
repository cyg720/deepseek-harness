/**
 * dsh-jobs' owned branded id, carried across the registry, the model-facing
 * control surface, and the client wire.
 *
 * It lives in its own leaf because the package root and `./types` both reach
 * `dsh-agent` through the owner and listener signatures, which a Client program
 * cannot resolve even as a type. A browser-safe consumer imports the id here;
 * `Branded<B>` itself comes from the zero-dependency `@deepseek-ai/dsh-brand`.
 *
 * @module @deepseek-ai/dsh-jobs/brand
 */
/**
 * 文件职责：定义后台任务跨注册表、模型控制面和客户端线协议共享的品牌化标识。
 * 技术维度：使用零依赖 Branded 类型建立浏览器安全的 JobId 叶子入口。
 * 产品维度：让用户和模型对后台任务执行查询、控制时不会把普通字符串误作其他领域标识。
 * 逻辑维度：声明 JobId 不透明类型，并提供把注册表生成字符串转换为该类型的同名函数。
 * 关键边界：ID 形如 <kind>-N 且可预测，安全性依赖所有者授权而不是保密；函数不校验输入。
 * 新手阅读建议：先理解品牌只影响编译期，再沿 JobId 查找注册表产生和客户端消费位置。
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/**
 * Identifies a background job. The registry generates `<kind>-N`; predictable
 * ids rely on owner authorization rather than secrecy.
 */
/** JobId：标识一个后台任务；注册表生成 <kind>-N，授权不能依赖该值不可猜。 */
export type JobId = Branded<'JobId'>

/**
 * Brand a string as a {@link JobId}.
 * @param id - the raw job-id string (the registry generates `<kind>-N`).
 * @returns the same string, branded; no validation is performed.
 */
/**
 * 把原始任务字符串标记为 JobId。
 * @param id - 注册表生成的原始任务 ID，通常形如 <kind>-N。
 * @returns 运行时不变、仅增加编译期品牌的同一字符串。
 * @example JobId('shell-1')。
 */
export function JobId(id: string): JobId {
  return id as JobId
}
