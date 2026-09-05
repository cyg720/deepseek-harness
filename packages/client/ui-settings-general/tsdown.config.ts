/**
 * 文件职责：声明通用设置与产品引导插件的 Node 端和浏览器端构建入口。
 * 技术维度：用 tsdown `clientBundle` 预设打包常规设置、外壳内容、词典和欢迎提示。
 * 产品维度：为用户提供基础偏好配置、设置入口及版本化的新手欢迎信息。
 * 逻辑维度：导入共享预设，再传入包名和两个 Node 端入口生成默认配置。
 * 关键边界：欢迎提示按版本控制；本文件不管理设置值且 invariant 入口不可省略。
 * 新手阅读建议：先看构建入口，再区分设置分区、外壳插槽和欢迎提示三条路径。
 */
import { clientBundle } from '../tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-client-ui-settings-general', ['lib/types/index.js'])
