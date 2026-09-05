/**
 * 文件职责：声明工作区选择界面插件的 Node 端与浏览器端构建入口。
 * 技术维度：使用 tsdown `clientBundle` 预设打包同一 WorkspacePicker 的多个插槽贡献。
 * 产品维度：用户可从侧栏或空白页选择当前任务使用的工作目录。
 * 逻辑维度：导入共享预设，再传入包名与两个 Node 端入口生成默认配置。
 * 关键边界：目录访问由主机能力授权；本文件只构建且 invariant 入口不能删除。
 * 新手阅读建议：先看构建入口，再比较选择器在侧栏和空白状态插槽中的注册。
 */
import { clientBundle } from '../tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-client-ui-workspace', ['lib/types/index.js'])
