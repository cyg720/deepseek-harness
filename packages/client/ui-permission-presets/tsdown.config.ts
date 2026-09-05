/**
 * 文件职责：声明权限预设界面插件的 Node 端与浏览器端构建入口。
 * 技术维度：通过 tsdown `clientBundle` 预设打包默认权限设置和当前会话命令界面。
 * 产品维度：用户可为新会话设定权限基线，也可查看或调整当前会话权限。
 * 逻辑维度：导入共享预设，再用包名和两个 Node 端入口生成默认配置。
 * 关键边界：实际授权由权限能力执行；界面配置不能替代执行端校验，invariant 必须保留。
 * 新手阅读建议：先看构建输出，再区分新会话默认值和当前会话权限投影。
 */
import { clientBundle } from '../tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-client-ui-permission-presets', ['lib/types/index.js'])
