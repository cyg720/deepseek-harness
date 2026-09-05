/**
 * 文件职责：声明动态 Cordis 客户端运行器的 Node 端与浏览器端构建入口。
 * 技术维度：调用 tsdown `clientBundle` 预设打包闭包求值、守卫门面和 Loader 条目。
 * 产品维度：让动态双端插件的浏览器部分能够安全加载、运行和订阅事件。
 * 逻辑维度：导入共享预设，再用包名及两个 Node 端入口生成默认配置。
 * 关键边界：动态代码必须经过运行器守卫；本文件不执行代码且 invariant 必须保留。
 * 新手阅读建议：先看双端入口，再按代码求值、权限守卫和 Loader 注册阅读源码。
 */
import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-cordis-client-runner', ['lib/types/index.js'])
