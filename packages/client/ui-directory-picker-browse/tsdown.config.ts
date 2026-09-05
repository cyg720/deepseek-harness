/**
 * 文件职责：声明应用内目录浏览插件的 Node 端与浏览器端构建入口。
 * 技术维度：使用 tsdown `clientBundle` 预设打包目录列表与创建目录界面。
 * 产品维度：让用户不离开 Web 应用即可浏览主机目录并选择工作区。
 * 逻辑维度：导入共享预设，再以包名和两个 Node 端入口生成默认配置。
 * 关键边界：主机目录权限由后端能力控制；本文件只负责构建且必须保留 invariant。
 * 新手阅读建议：先看构建入口，再追踪主机目录数据怎样传给目录流程界面。
 */
import { clientBundle } from '../tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-client-ui-directory-picker-browse', ['lib/types/index.js'])
