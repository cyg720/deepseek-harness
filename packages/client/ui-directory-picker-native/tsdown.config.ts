/**
 * 文件职责：声明原生目录选择插件的 Node 端与浏览器端构建入口。
 * 技术维度：通过 tsdown `clientBundle` 预设打包调用操作系统选择器的无界面插件。
 * 产品维度：让用户使用熟悉的系统目录窗口选择 Web 客户端工作区。
 * 逻辑维度：导入共享预设，再传入包名及两个 Node 端入口生成默认配置。
 * 关键边界：系统选择器是否可用取决于主机环境；invariant 构建入口不能删除。
 * 新手阅读建议：先理解此处只声明构建，再查看无界面插槽贡献如何调用主机选择器。
 */
import { clientBundle } from '../tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-client-ui-directory-picker-native', ['lib/types/index.js'])
