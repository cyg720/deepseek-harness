/**
 * 文件职责：声明插件设置分区的 Node 端与浏览器端构建入口。
 * 技术维度：以 tsdown `clientBundle` 预设打包功能标签页和主机侧插件配置卡片。
 * 产品维度：让用户在一个设置分区内浏览并调整支持配置的插件功能。
 * 逻辑维度：导入共享预设，再传入包名与两个 Node 端入口生成默认配置。
 * 关键边界：只有声明为可配置的主机插件才能编辑；本文件只构建且保留 invariant。
 * 新手阅读建议：先看构建输出，再区分标签页注册与插件配置卡片的数据来源。
 */
import { clientBundle } from '../tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-client-ui-settings-plugins', ['lib/types/index.js'])
