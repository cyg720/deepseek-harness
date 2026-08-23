/**
 * ================================ 文件注释 ================================
 * 【文件职责】把设置域的模式服务（settingsSchema）封装成绑定回调集，
 *             供模型设置页的存储与呈现组件使用。
 * 【技术维度】类型收缩（Pick 接口）+ 闭包绑定：React 组件拿到的是纯回调，
 *             不会暴露 Cordis 服务上下文（客户端包纯度）。
 * 【产品维度】模型设置页编辑器的模式重水合/校验/路径操作。
 * 【逻辑维度】createSettingsSchemaOperations 把服务方法逐一绑定为独立回调。
 * 【关键边界】只暴露白名单方法；回调签名与服务的完全一致。
 * 【新手阅读建议】对照 ui-settings/schema.ts 的服务实现阅读。
 * ==========================================================================
 */
import type {
  SettingsSchemaService,
} from '@deepseek-ai/dsh-client-ui-settings/client'

/** Plain schema callbacks exposed to Models stores and presentation components. */
export type SettingsSchemaOperations = Pick<
  SettingsSchemaService,
  'rehydrate' | 'validate' | 'nodeAtPath' | 'getPath' | 'hasPath' | 'setPath' | 'deletePath'
>

/**
 * Hide the Cordis service identity behind bound schema callbacks.
 * @param service - settings-owned schema service available in the apply context.
 * @returns callbacks that cannot expose the service context to React components.
 */
export function createSettingsSchemaOperations(service: SettingsSchemaService): SettingsSchemaOperations {
  return {
    rehydrate: serialized => service.rehydrate(serialized),
    validate: (schema, draft) => service.validate(schema, draft),
    nodeAtPath: (root, path) => service.nodeAtPath(root, path),
    getPath: (value, path) => service.getPath(value, path),
    hasPath: (value, path) => service.hasPath(value, path),
    setPath: (root, path, value) => service.setPath(root, path, value),
    deletePath: (root, path) => service.deletePath(root, path),
  }
}
