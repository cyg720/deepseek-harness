/** Deterministic in-memory PTY backend for transcript snapshots. */
/*
 * 文件职责：为 ACP 转录快照提供确定性的内存伪终端后端。
 * 技术维度：使用 JavaScript 类和 Promise 模拟终端发送、增量读取、滚屏、信号、状态与关闭。
 * 产品维度：让终端交互快照无需真实 shell 也能稳定复现提示符、输出和等待原因。
 * 逻辑维度：SnapshotSession 累计 scrollback；startSend 生成固定输出，read 分页读取，其余方法返回确定结果；apply 注册后端。
 * 关键边界：只用于测试，命令文本不会执行；cancel 永远失败，signal 固定投递成功，关闭固定退出码 0。
 * 新手阅读建议：先看三个实例字段，再沿 startSend/read/status/close 阅读，最后看 apply 如何注册 spawn。
 */

/* 模拟单个终端会话，保存确定性提示符、状态和滚屏文本。 */
class SnapshotSession {
  // 固定欢迎提示符。
  motd = 'dsh> '
  // 当前会话状态；运行中或正常退出。
  statusValue = { kind: 'running' }
  // 累积终端输出，初始只含提示符。
  scrollback = 'dsh> '

  /** 发送输入并生成固定输出。@param request 含 text 的发送请求。@returns done/readOutput/cancel 句柄。@example session.startSend({ text: 'pwd' })。 */
  startSend(request) {
    // 本次发送产生的可见终端文本。
    const viewport = `${request.text}\nPTY_OK\ndsh> `
    this.scrollback += viewport
    // 本次发送最终结果；等待原因为 stdin_read，且从不截断。
    const result = {
      viewport,
      waitReason: 'stdin_read',
      sessionStatus: this.statusValue,
      truncated: false,
    }
    // 增量输出是否已读取；确保 viewport 只返回一次。
    let consumed = false
    return {
      done: Promise.resolve(result),
      // 增量读取函数；首次返回 viewport，后续返回空 delta。
      readOutput: () => {
        if (consumed) return { delta: '', truncated: false }
        consumed = true
        return { delta: viewport, truncated: false }
      },
      // 快照后端不支持取消，固定返回 false。
      cancel: () => false,
    }
  }

  /** 分页读取滚屏。@param request 可选 offset/count。@returns 文本与行范围。@example session.read({ offset: 0, count: 10 })。 */
  read(request) {
    // 按换行拆分后的全部滚屏行。
    const lines = this.scrollback.split('\n')
    // 从末尾跳过的行数，默认 0。
    const offset = request.offset ?? 0
    // 最多返回的行数，默认 500。
    const count = request.count ?? 500
    // 不含末尾跳过区域的结束索引。
    const end = lines.length - offset
    // 保证不小于 0 的起始索引。
    const start = Math.max(0, end - count)
    // 选中行重新连接成的返回文本。
    const text = lines.slice(start, end).join('\n')
    return { text, totalLines: lines.length, lineBegin: offset, lineEnd: offset + text.split('\n').length, truncated: false }
  }

  /** 模拟信号投递。@returns 固定 delivered=true 和进程组 1。 */
  signal() {
    return Promise.resolve({ delivered: true, targetPgid: 1 })
  }

  /** 读取当前状态。@returns statusValue 当前对象。 */
  status() {
    return this.statusValue
  }

  /** 正常关闭会话。@returns 完成的 Promise。 */
  close() {
    this.statusValue = { kind: 'exited', exitCode: 0, signal: null }
    return Promise.resolve()
  }
}

/** Cordis plugin name. */
/* Cordis 配置引用的插件名称。 */
export const name = 'pty-snapshot-backend'
/** Required PTY service. */
/* 启动前必须注入的终端服务。 */
export const inject = ['terminals']

/** Register the deterministic snapshot backend. */
/* 注册快照后端。@param ctx 提供 terminals 服务的 Cordis 上下文。@returns 无。@example apply(ctx)。 */
export function apply(ctx) {
  ctx.terminals.registerBackend({
    type: 'shell',
    spawn: () => Promise.resolve(new SnapshotSession()),
  })
}
