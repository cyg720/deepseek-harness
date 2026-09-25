/** 奇术模型设置复用官方状态和操作，界面插件不创建第二个目录或欢迎确认状态。 */
import { Service, type Context } from '@deepseek-ai/cordis'
import type { ModelsSettingsStore } from '../store.ts'
import type { ModelsOperations } from '../operations.ts'
import type { SettingsSchemaOperations } from '../schema-operations.ts'
import type { WelcomeNoticeStore } from '../welcome-store.ts'

/** 官方与二开呈现共同消费的模型配置事实及操作。 */
export interface ModelsSettingsFace {
  readonly controller: ModelsSettingsStore
  readonly operations: ModelsOperations
  readonly schema: SettingsSchemaOperations
  readonly welcome: WelcomeNoticeStore
}

declare module '@deepseek-ai/cordis' {
  interface Context { modelsSettings: ModelsSettingsAccess }
}

/** 官方插件拥有唯一实例，访问服务随该插件的 fiber 释放。 */
export class ModelsSettingsAccess extends Service {
  /**
   * 发布已有状态与操作，不触发额外目录读取或凭据请求。
   * @param ctx - 官方模型设置插件上下文。
   * @param face - 官方插件已创建的控制器、操作和引导状态。
   */
  constructor(ctx: Context, readonly face: ModelsSettingsFace) { super(ctx, 'modelsSettings') }
}
