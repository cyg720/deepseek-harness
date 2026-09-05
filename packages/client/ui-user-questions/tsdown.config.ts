/**
 * 文件职责：声明用户问答界面插件的 Node 端与浏览器端构建入口。
 * 技术维度：用 tsdown `clientBundle` 预设打包主机工具挂载和输入区接管界面。
 * 产品维度：代理需要补充信息时，可用结构化问题让用户直接作答。
 * 逻辑维度：导入共享预设，再以包名与两个 Node 端入口生成默认配置。
 * 关键边界：只有待回答问题存在时才接管输入区；invariant 入口必须保留。
 * 新手阅读建议：先看构建输出，再追踪主机问题事件如何驱动输入区切换。
 */
import { clientBundle } from '../tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-client-ui-user-questions', ['lib/types/index.js'])
