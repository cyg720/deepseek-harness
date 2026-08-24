/**
 * 文件职责：测试时探测 Node 网络服务器是否调用过 `listen`。
 * 技术维度：猴子补丁 Server 原型，并用同步文件追加记录每次监听行为。
 * 产品维度：验证 Web 启动测试不会意外重复或遗漏端口监听。
 * 逻辑维度：读取标记文件路径、保存原方法、包装调用并转发全部参数。
 * 关键边界：仅供测试子进程预加载；未设置环境变量时只透明转发。
 * 新手阅读建议：先看环境变量，再理解包装函数如何记录后调用原方法。
 */
import { appendFileSync } from 'node:fs'
import { Server } from 'node:net'

/** 标记文件路径；未设置时为 undefined，探针不写磁盘。 */
const marker = process.env.DSH_LISTEN_PROBE_MARKER
/** 原始 `Server.prototype.listen`；必须保存以避免包装函数递归调用自身。 */
const listen = Server.prototype.listen
/**
 * 包装服务器监听调用，记录一次标记后保持原始参数与返回值。
 * @param args 原 `listen` 的完整参数列表，取值形式由 Node 网络 API 决定。
 * @returns 原始 `listen` 的返回值，通常是当前 Server 实例。
 * @example 预加载本文件后调用 `server.listen(0)`，标记文件新增一行 `listen`。
 */
Server.prototype.listen = function (...args) {
  if (marker !== undefined) appendFileSync(marker, 'listen\n')
  return listen.apply(this, args)
}
