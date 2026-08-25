/**
 * Minimal MCP server over stdio for e2e testing of the dsh-mcp-client plugin.
 * Registers controlled tools with predictable behavior for asserting edge cases.
 *
 * Run: node fixture-server.ts
 */
/*
 * 文件职责：验证 fixture-server.ts 覆盖的MCP 客户端行为与异常场景。
 * 技术维度：使用 TypeScript、Vitest、异步协议连接和可控测试替身。
 * 产品维度：保障 Agent 能稳定使用MCP 客户端提供的外部能力。
 * 逻辑维度：准备上下文与协议数据，触发被测流程，再核对结果、呈现和资源清理。
 * 关键边界：远端消息不可信；连接可能中断；异步资源必须在用例结束时释放。
 * 新手阅读建议：先读辅助函数和夹具，再按 describe/it 阅读正常、失败与重连场景。
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

/** 中文说明：变量 server 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const server = new McpServer(
  { name: 'fixture-server', version: '1.0.0' },
  { capabilities: { tools: { listChanged: true } } },
)

server.registerTool('add', {
  title: 'Add Tool',
  description: 'Adds two numbers.',
  inputSchema: { a: z.number().describe('First number'), b: z.number().describe('Second number') },
}, async args => ({
  content: [{ type: 'text', text: String(args.a + args.b) }],
}))

server.registerTool('greet', {
  title: 'Greet Tool',
  description: 'Greets a person by name.',
  inputSchema: { name: z.string().describe('Name to greet') },
}, async args => ({
  content: [{ type: 'text', text: `Hello, ${args.name}!` }],
}))

server.registerTool('fail', {
  title: 'Fail Tool',
  description: 'Always returns an error.',
  inputSchema: {},
}, async () => ({
  content: [{ type: 'text', text: 'Something went wrong' }],
  isError: true,
}))

server.registerTool('image', {
  title: 'Image Tool',
  description: 'Returns an image content block.',
  inputSchema: {},
}, async () => ({
  content: [
    { type: 'text', text: 'Here is an image:' },
    { type: 'image', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', mimeType: 'image/png' },
    { type: 'text', text: 'End of image.' },
  ],
}))

server.registerTool('crash', {
  title: 'Crash Tool',
  description: 'Replies, then exits the server process (crash-recovery test).',
  inputSchema: {},
}, async () => {
  // Exit AFTER the response flushes so the caller observes a clean result
  // followed by a transport close, like a real post-reply crash.
  setTimeout(() => process.exit(7), 25)
  return { content: [{ type: 'text', text: 'crashing' }] }
})

// Dotted name: legal in MCP, illegal in the DeepSeek function-name contract.
// Exercises the bridge's normalize-and-hash public-name path end to end.
server.registerTool('admin.reset', {
  title: 'Admin Reset Tool',
  description: 'Tool with a dotted name (normalization test).',
  inputSchema: {},
}, async () => ({
  content: [{ type: 'text', text: 'reset done' }],
}))

/** 中文说明：变量 transport 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const transport = new StdioServerTransport()
await server.connect(transport)
