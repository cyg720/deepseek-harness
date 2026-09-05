/**
 * Outbound HTTP proxy support for DeepSeek Harness.
 *
 * Node's built-in `fetch` ignores `HTTP_PROXY` and friends, so every harness request would connect
 * directly no matter what the user exported. The launcher resolves one policy from the launch
 * environment and installs it as undici's global dispatcher, which is what `fetch` resolves — so
 * LLM adapters, web search, MCP over HTTP, and telemetry are covered without touching their code.
 *
 * This is a library, not a plugin: transport policy has one answer per process, so there is nothing
 * for a composition to mount, swap, or scope.
 *
 * Four functions, one per way a caller needs the policy — install it, ask how to send one request,
 * build a child's environment, and strip the ambient one for a replay.
 * @module @deepseek-ai/dsh-http-proxy
 */

/*
 * 【文件职责】提供进程级出站 HTTP 代理库，把启动环境解析为统一策略并安装为 fetch 使用的全局 dispatcher。
 */

export {
  clearedProxyEnv,
  installProxyFromEnvironment,
  proxyEnvironmentForChild,
  proxyRouteFor,
  type ProxyRoute,
} from './install.ts'
