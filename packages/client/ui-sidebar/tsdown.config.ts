/**
 * 文件职责：声明会话侧栏插件的 Node 端与浏览器端构建入口。
 * 技术维度：通过 tsdown `clientBundle` 预设打包多级会话树、搜索和状态标记。
 * 产品维度：帮助用户快速查找、分组并切换不同会话。
 * 逻辑维度：导入共享预设，再用包名与两个 Node 端入口形成默认配置。
 * 关键边界：会话数据仍由对象层拥有；侧栏只负责查看状态，invariant 入口不得省略。
 * 新手阅读建议：先看构建入口，再按会话树、分组、搜索和状态点阅读组件。
 */
import { clientBundle } from '../tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-client-ui-sidebar', ['lib/types/index.js'])
