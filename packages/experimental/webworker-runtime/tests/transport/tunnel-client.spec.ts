/**
 * Check the page half of the tunnel against hand-fed frames: a stub worker replaces
 * the real one, so every reply shape — unary, streamed, refused, aborted — can be
 * delivered on demand and the client's reaction observed directly.
 *
 * The refusal warnings are the reason this suite exists. They are the only signal
 * that separates "the tunnel refused" from "the host tree answered with an error"
 * in an acceptance run's console log, and a diagnostic nothing exercises is a
 * diagnostic that silently stops working.
 *
 * The refusal text is matched verbatim on purpose: the worker composes it from the
 * expanded cause chain, so both sides hold each other to it. Do not relax these
 * expectations to make a change pass — agree the new text with the worker host first.
 * @remarks 文件说明：文件职责：验证 experimental/webworker-runtime 中 tunnel client
 * spec 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { expect, test } from 'vitest'
import { WorkerTunnel } from '@deepseek-ai/dsh-experimental-webworker-runtime/src/client/client.ts'

// Both sides are serialized here, at call time, rather than inside the case: the
// blocks below reuse and clear the `warnings` array, so a captured reference
// would read a later block's state by the time the case executes.
/**
 * 常量说明：check 用于处理 check 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 check 相关流程；使用场景由所在模块及调用位置决定。
 * @param label （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param actual （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param expected （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 check(label, actual, expected)，并按返回类型处理结果。
 */
const check = (label: string, actual: unknown, expected: unknown): void => {
  /**
   * 常量说明：seen、wanted 用于处理 seen、wanted 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const [seen, wanted] = [JSON.stringify(actual), JSON.stringify(expected)]
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  test(label, () => { expect(seen).toBe(wanted) })
}

/**
 * 常量说明：warnings 用于处理 warnings 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const warnings: string[] = []
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：message（string）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(message)，并按返回类型处理结果。
 */
console.warn = (message: string) => { warnings.push(message) }
;(globalThis as { location?: unknown }).location = { origin: 'http://localhost:4173' }

type StubListener = (event: { data?: unknown; message?: string }) => void

/** A worker stand-in: collects what the page sent, replays what the test delivers.
 * @remarks 中文说明：功能说明：处理 stubWorker 相关流程；使用场景由所在模块及调用位置决定。；返回值：{ worker:
 * Worker sent: { t: string; id: number }[] deliver: (frame: u…；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 stubWorker()，并按返回类型处理结果。 */
function stubWorker(): {
  worker: Worker
  sent: { t: string; id: number }[]
  deliver: (frame: unknown) => void
  fail: (message: string) => void
} {
  /**
   * 常量说明：listeners 用于处理 listeners 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const listeners: StubListener[] = []
  /**
   * 常量说明：errorListeners 用于处理 errorListeners 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const errorListeners: StubListener[] = []
  /**
   * 常量说明：sent 用于处理 sent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const sent: { t: string; id: number }[] = []
  /**
   * 常量说明：worker 用于处理 worker 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：type（string）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；参数：listener（StubListener）：接收后续状态或事件并执行调用方逻辑；
   * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(type, listener)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：frame（unknown）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(frame)，并按返回类型处理结果。
   */
  const worker = {
    addEventListener: (type: string, listener: StubListener) => {
      if (type === 'message') listeners.push(listener)
      if (type === 'error') errorListeners.push(listener)
    },
    postMessage: (frame: unknown) => { sent.push(frame as { t: string; id: number }) },
  } as unknown as Worker
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：frame（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(frame)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：message（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(message)，并按返回类型处理结果。
   */
  return {
    worker,
    sent,
    deliver: (frame) => { /**
 * 变量说明：listener 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
 */
for (const listener of listeners) listener({ data: frame }) },
    fail: (message) => { /**
 * 变量说明：listener 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
 */
for (const listener of errorListeners) listener({ message }) },
  }
}

// The opening frame preserves overlay order for deterministic pre-boot mounts.
{
  /**
   * 常量说明：worker、sent 用于处理 worker、sent 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const { worker, sent } = stubWorker()
  /**
   * 常量说明：tunnel 用于处理 tunnel 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const tunnel = new WorkerTunnel(worker)
  tunnel.init('https://preview.test/base.tar.gz', [
    'https://preview.test/first.tar.gz',
    'https://preview.test/second.tar.gz',
  ])
  check('the init frame carries ordered overlays', sent[0], {
    t: 'init',
    image: 'https://preview.test/base.tar.gz',
    overlays: ['https://preview.test/first.tar.gz', 'https://preview.test/second.tar.gz'],
  })

  /**
   * 常量说明：direct 用于处理 direct 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const direct = stubWorker()
  new WorkerTunnel(direct.worker).init('https://preview.test/base.tar.gz')
  check('the direct init path defaults to no overlays', direct.sent[0], {
    t: 'init', image: 'https://preview.test/base.tar.gz', overlays: [],
  })
}

// A normal reply resolves and says nothing on the console.
{
  /**
   * 常量说明：worker、sent、deliver 用于处理 worker、sent、deliver 相关数据，作用于当前作用域；
   * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const { worker, sent, deliver } = stubWorker()
  /**
   * 常量说明：tunnel 用于处理 tunnel 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const tunnel = new WorkerTunnel(worker)
  /**
   * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const response = tunnel.fetch('/api/session.list', { method: 'POST', body: '{"a":1}' })
  /**
   * 常量说明：request 用于处理 request 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const request = sent[0] as unknown as { t: string; id: number; method: string; url: string; body: ArrayBuffer }
  check('the request frame carries method and absolute url', [request.t, request.id, request.method, request.url],
    ['req', 1, 'POST', 'http://localhost:4173/api/session.list'])
  check('the request body travels as bytes', new TextDecoder().decode(request.body), '{"a":1}')
  deliver({ t: 'res', id: 1, status: 200, headers: {}, message: '{"ok":true}' })
  /**
   * 常量说明：resolved 用于处理 resolved 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const resolved = await response
  check('a normal reply resolves', resolved.status, 200)
  check('a normal reply carries its body', await resolved.text(), '{"ok":true}')
  check('a normal reply warns about nothing', warnings.length, 0)
}

// A null-body status resolves without a body rather than throwing.
{
  /**
   * 常量说明：worker、deliver 用于处理 worker、deliver 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const { worker, deliver } = stubWorker()
  /**
   * 常量说明：tunnel 用于处理 tunnel 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const tunnel = new WorkerTunnel(worker)
  /**
   * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const response = tunnel.fetch('/api/session.delete', { method: 'POST' })
  deliver({ t: 'res', id: 1, status: 204, headers: {} })
  check('204 resolves with a null body', (await response).body, null)
}

// A streamed reply reassembles in order and closes.
{
  /**
   * 常量说明：worker、deliver 用于处理 worker、deliver 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const { worker, deliver } = stubWorker()
  /**
   * 常量说明：tunnel 用于处理 tunnel 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const tunnel = new WorkerTunnel(worker)
  /**
   * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const response = tunnel.fetch('/api/session.events', { method: 'POST' })
  deliver({ t: 'res-head', id: 1, status: 200, headers: { 'content-type': 'text/event-stream' } })
  /**
   * 常量说明：resolved 用于处理 resolved 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const resolved = await response
  /**
   * 常量说明：encoder 用于处理 encoder 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const encoder = new TextEncoder()
  deliver({ t: 'res-chunk', id: 1, chunk: encoder.encode('one ').buffer })
  deliver({ t: 'res-chunk', id: 1, chunk: encoder.encode('two').buffer })
  deliver({ t: 'res-end', id: 1 })
  check('a streamed reply reassembles in order', await resolved.text(), 'one two')
}

// A refusal names the request, so a console log alone tells tunnel from tree.
{
  warnings.length = 0
  /**
   * 常量说明：worker、deliver 用于处理 worker、deliver 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const { worker, deliver } = stubWorker()
  /**
   * 常量说明：tunnel 用于处理 tunnel 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const tunnel = new WorkerTunnel(worker)
  /**
   * 常量说明：refused 用于处理 refused 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const refused = tunnel.fetch('/api/session.create', { method: 'POST' })
  deliver({ t: 'res', id: 1, status: 503, headers: {}, message: 'host is not serving yet' })
  check('a 5xx reply still resolves', (await refused).status, 503)
  check('a 5xx reply is reported once', warnings, [
    'web-preview tunnel: request 1 POST http://localhost:4173/api/session.create → HTTP 503: host is not serving yet',
  ])
}

// An error frame rejects the caller and reports the same request.
{
  warnings.length = 0
  /**
   * 常量说明：worker、deliver 用于处理 worker、deliver 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const { worker, deliver } = stubWorker()
  /**
   * 常量说明：tunnel 用于处理 tunnel 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const tunnel = new WorkerTunnel(worker)
  /**
   * 常量说明：errored 用于处理 errored 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const errored = tunnel.fetch('/api/session.history', { method: 'POST' })
  deliver({ t: 'res-err', id: 1, message: 'boom: nested cause' })
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（unknown）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
   */
  check('an error frame rejects', await errored.then(() => 'resolved', (error: unknown) => (error as Error).message),
    'web-preview tunnel: boom: nested cause')
  check('an error frame is reported once', warnings, [
    'web-preview tunnel: request 1 POST http://localhost:4173/api/session.history → res-err: boom: nested cause',
  ])
}

// A 4xx is the host tree answering, not the tunnel refusing: no warning.
{
  warnings.length = 0
  /**
   * 常量说明：worker、deliver 用于处理 worker、deliver 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const { worker, deliver } = stubWorker()
  /**
   * 常量说明：tunnel 用于处理 tunnel 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const tunnel = new WorkerTunnel(worker)
  /**
   * 常量说明：denied 用于处理 denied 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const denied = tunnel.fetch('/api/plugin.mount', { method: 'POST' })
  deliver({ t: 'res', id: 1, status: 403, headers: {}, message: 'privileged' })
  check('4xx resolves', (await denied).status, 403)
  check('4xx stays silent', warnings, [])
}

// Aborting sends an abort frame and rejects with AbortError.
{
  /**
   * 常量说明：worker、sent、deliver 用于处理 worker、sent、deliver 相关数据，作用于当前作用域；
   * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const { worker, sent, deliver } = stubWorker()
  /**
   * 常量说明：tunnel 用于处理 tunnel 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const tunnel = new WorkerTunnel(worker)
  /**
   * 常量说明：controller 用于处理 controller 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const controller = new AbortController()
  /**
   * 常量说明：aborted 用于处理 aborted 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const aborted = tunnel.fetch('/api/session.events', { method: 'POST', signal: controller.signal })
  controller.abort()
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（unknown）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
   */
  check('abort rejects with AbortError', await aborted.then(() => 'resolved', (error: unknown) => (error as Error).name), 'AbortError')
  check('abort reaches the worker', sent.at(-1), { t: 'abort', id: 1 })
  // A late reply to an aborted request must not resurrect it.
  deliver({ t: 'res', id: 1, status: 200, headers: {}, message: 'late' })
}

// A logical Gateway stream carries decoded values and one terminal frame.
{
  /**
   * 常量说明：worker、sent、deliver 用于处理 worker、sent、deliver 相关数据，作用于当前作用域；
   * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const { worker, sent, deliver } = stubWorker()
  /**
   * 常量说明：tunnel 用于处理 tunnel 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const tunnel = new WorkerTunnel(worker)
  /**
   * 常量说明：signal 用于处理 signal 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const signal = new AbortController()
  /**
   * 常量说明：stream 用于处理 stream 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const stream = tunnel.open('session/follow', { args: { sessionId: 'session-1' } }, signal.signal)
    [Symbol.asyncIterator]()
  /**
   * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const first = stream.next()
  check('a logical stream opens on the worker-local carrier', sent[0], {
    t: 'stream-open', id: 1, endpoint: 'session/follow', payload: { args: { sessionId: 'session-1' } },
  })
  deliver({ t: 'stream-item', id: 1, value: { type: 'baseline' } })
  check('a logical stream yields decoded values', await first, { value: { type: 'baseline' }, done: false })
  /**
   * 常量说明：ended 用于处理 ended 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const ended = stream.next()
  deliver({ t: 'stream-end', id: 1 })
  check('a logical stream closes normally', await ended, { done: true, value: undefined })
  check('normal stream completion sends no cancellation', sent, [
    { t: 'stream-open', id: 1, endpoint: 'session/follow', payload: { args: { sessionId: 'session-1' } } },
  ])
}

// Host failures retain their code and details for the Gateway Client bundle to normalize.
{
  /**
   * 常量说明：worker、deliver 用于处理 worker、deliver 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const { worker, deliver } = stubWorker()
  /**
   * 常量说明：tunnel 用于处理 tunnel 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const tunnel = new WorkerTunnel(worker)
  /**
   * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const pending = tunnel.open('session/follow', {}, new AbortController().signal).next()
  deliver({
    t: 'stream-error',
    id: 1,
    failure: {
      kind: 'remote',
      code: 'session-not-found',
      message: 'fixture Session is absent',
      details: { sessionId: 'session-1' },
    },
  })
  /**
   * 常量说明：failure 用于处理 failure 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（unknown）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
   */
  const failure = await pending.then(() => undefined, (error: unknown) => error as {
    message: string
    dshRemoteStreamFailure: unknown
  })
  check('a logical Host failure retains its structural marker', {
    message: failure?.message,
    dshRemoteStreamFailure: failure?.dshRemoteStreamFailure,
  }, {
    message: 'fixture Session is absent',
    dshRemoteStreamFailure: {
      kind: 'remote', code: 'session-not-found', details: { sessionId: 'session-1' },
    },
  })
}

// Caller cancellation keeps the caller's exact reason and reaches the worker once.
{
  /**
   * 常量说明：worker、sent、deliver 用于处理 worker、sent、deliver 相关数据，作用于当前作用域；
   * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const { worker, sent, deliver } = stubWorker()
  /**
   * 常量说明：tunnel 用于处理 tunnel 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const tunnel = new WorkerTunnel(worker)
  /**
   * 常量说明：abort 用于处理 abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const abort = new AbortController()
  /**
   * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const pending = tunnel.open('workspace/follow', {}, abort.signal).next()
  /**
   * 常量说明：reason 用于处理 reason 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const reason = new Error('caller stopped the Workspace feed')
  abort.abort(reason)
  deliver({ t: 'stream-item', id: 1, value: 'late' })
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（unknown）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
   */
  check('logical stream cancellation preserves the caller reason', await pending.then(
    () => 'resolved',
    (error: unknown) => error === reason ? 'same reason' : 'different reason',
  ), 'same reason')
  check('logical stream cancellation reaches the worker', sent.at(-1), { t: 'abort', id: 1 })
}

// A failed worker is a carrier failure, not a fabricated Host Remote error.
{
  warnings.length = 0
  /**
   * 常量说明：worker、fail 用于处理 worker、fail 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const { worker, fail } = stubWorker()
  /**
   * 常量说明：tunnel 用于处理 tunnel 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const tunnel = new WorkerTunnel(worker)
  /**
   * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const pending = tunnel.open('$events', { args: {} }, new AbortController().signal).next()
  fail('worker crashed')
  /**
   * 常量说明：failure 用于处理 failure 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（unknown）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
   */
  const failure = await pending.then(() => undefined, (error: unknown) => error as {
    message: string
    dshRemoteStreamFailure: unknown
  })
  check('worker failure carries the carrier marker', {
    message: failure?.message,
    dshRemoteStreamFailure: failure?.dshRemoteStreamFailure,
  }, {
    message: 'web-preview tunnel: worker failed: worker crashed',
    dshRemoteStreamFailure: { kind: 'carrier' },
  })
}
