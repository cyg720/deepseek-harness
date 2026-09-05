/**
 * 文件职责：声明插件清单设置页的 Node 端与浏览器端构建入口。
 * 技术维度：通过 tsdown `clientBundle` 预设打包 Cordis Loader 清单的只读视图。
 * 产品维度：让用户在 Web 设置中查看当前加载的插件及其基本状态。
 * 逻辑维度：导入共享预设，再用包名和两个 Node 端入口生成默认配置。
 * 关键边界：该页面只读，不负责启停或配置插件；invariant 构建入口不可删除。
 * 新手阅读建议：先看构建入口，再追踪 Loader 清单数据如何映射为设置标签页。
 */
import { clientBundle } from '../tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-client-ui-settings-plugin-inventory', ['lib/types/index.js'])
