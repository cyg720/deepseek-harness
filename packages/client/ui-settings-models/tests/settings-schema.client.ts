/**
 * 文件职责：为模型设置组件夹具提供无状态的设置模式操作对象。
 * 技术维度：组合真实 Cordis Context、SettingsSchemaService 与客户端操作适配器。
 * 产品维度：让模型设置测试以接近真实设置服务的方式查询和操作模式。
 * 逻辑维度：创建空上下文，实例化模式服务，再转换为组件所需操作接口。
 * 关键边界：对象仅供测试夹具使用，不挂载生产插件，也不保存跨测试状态。
 * 新手阅读建议：先看最内层 Context，再按服务实例和操作适配器由内向外阅读。
 */
import { Context } from '@deepseek-ai/cordis'
import { SettingsSchemaService } from '@deepseek-ai/dsh-client-ui-settings/src/client/schema.ts'
import { createSettingsSchemaOperations } from '../src/client/schema-operations.ts'

/** Stateless schema operations used by settings-model component fixtures. */
/**
 * 模型设置夹具共享的无状态操作常量；值只暴露模式操作，不包含持久状态。
 * 使用示例：测试组件把 `settingsSchema` 作为对应 props 传入；无需手动释放。
 */
export const settingsSchema = createSettingsSchemaOperations(new SettingsSchemaService(new Context()))
