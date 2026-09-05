/**
 * 文件职责：声明 Web 外壳布局插件的 Node 端与浏览器端构建入口。
 * 技术维度：以 tsdown `clientBundle` 预设打包三栏布局、拖拽手柄和查看状态服务。
 * 产品维度：提供可调整的导航、会话和辅助面板，构成应用主界面骨架。
 * 逻辑维度：导入共享预设，再用包名与两个 Node 端入口生成默认配置。
 * 关键边界：布局服务只管理查看状态；业务会话数据不得移入其中，invariant 必须保留。
 * 新手阅读建议：先看构建入口，再从 AppFrame 追踪面板状态与拖拽更新。
 */
import { clientBundle } from '../tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-client-ui-layout', ['lib/types/index.js'])
