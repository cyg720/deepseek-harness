/*
 * ================================ 文件注释 ================================
 * 【文件职责】ui-workflow-run 包的不变量伴生插件：向 invariant 服务登记本包所有权。
 * 【技术维度】Cordis 伴生插件 + dsh-invariants 注册 API。
 * 【产品维度】无 UI；属于"包级不变量"基础设施。
 * 【逻辑维度】apply() 调用 ctx.invariants.register(PACKAGE_NAME, install) 登记所有权。
 * 【关键边界】整个文件在 jscpd:ignore 区域；插件贡献一个 effect 拥有的会话定义、
 *             键控渲染器与字典，清理由测试证明（耐久事件不变式在宿主工具包），
 *             故无运行时不变式。
 * 【新手阅读建议】模板化伴生文件，可跳过。
 * ==========================================================================
 */
/** Package-owned invariant companion for the workflow-run UI plugin. */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-workflow-run'

/** Cordis companion plugin name. */
export const name = 'client-ui-workflow-run-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the browser plugin contributes one effect-owned
 * Conversation Definition, keyed renderer, and dictionary; tests prove their
 * disposal and the Host tool package owns the durable event invariant.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
