/**
 * 文件职责：声明设置领域基础插件的 Node 端与浏览器端构建入口。
 * 技术维度：使用 tsdown `clientBundle` 预设打包设置命名空间服务和插槽类型定义。
 * 产品维度：为各功能设置页提供统一的组合位置和命名规则。
 * 逻辑维度：导入共享预设，再以包名及两个 Node 端入口生成默认配置。
 * 关键边界：该包只提供设置基础能力，不应包含具体功能设置；invariant 必须保留。
 * 新手阅读建议：先看构建配置，再理解命名空间服务和设置插槽怎样供其他插件使用。
 */
import { clientBundle } from '../tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-client-ui-settings', ['lib/types/index.js'])
