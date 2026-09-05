/**
 * 文件职责：声明模型设置与引导对话框插件的 Node 端和浏览器端构建入口。
 * 技术维度：使用 tsdown `clientBundle` 预设打包模型设置及凭据关联界面。
 * 产品维度：帮助用户配置模型并完成首次使用所需的模型与凭据准备。
 * 逻辑维度：导入共享预设，再以包名及两个 Node 端入口生成默认配置。
 * 关键边界：凭据数据由专门服务持有；界面不得自行保存敏感值，invariant 必须保留。
 * 新手阅读建议：先看构建配置，再追踪设置数据与凭据状态怎样合并进对话框。
 */
import { clientBundle } from '../tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-client-ui-settings-models', ['lib/types/index.js'])
