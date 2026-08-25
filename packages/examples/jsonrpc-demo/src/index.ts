/**
 * Bin-only app package: its generic and packaged entries discover an external
 * `cordis.yml` and own process exit. This module exports no composition plugin;
 * the config chooses whether to load the
 * {@link @deepseek-ai/dsh-sdk-jsonrpc-server} serving plugin.
 *
 * @module @deepseek-ai/dsh-sdk-jsonrpc-demo
 */
/*
 * 文件职责：为仅含命令行入口的 JSON-RPC 示例包提供空的包根模块。
 * 技术维度：使用 ESM 空导出，实际启动由 bin 与外部 Cordis 配置完成。
 * 产品维度：用户可运行 JSON-RPC SDK 示例，而不会误把包根当成组合插件。
 * 逻辑维度：通用和打包入口寻找配置并管理退出，本文件不导出插件。
 * 关键边界：不要在包根添加默认插件；服务组合必须继续由 cordis.yml 决定。
 * 新手阅读建议：跳过空导出，依次阅读 bin.ts、runner.ts 和示例配置。
 */

/* 空导出仅建立 ESM 包根，不产生运行时 API。 */
export {}
