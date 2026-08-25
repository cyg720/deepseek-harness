/** Instance-owned concurrency bound for native image transformations. */
/*
 * 文件职责：限制单个附件服务实例同时执行的原生图片压缩任务数量。
 * 技术维度：使用 Promise、FIFO 等待队列和显式计数实现轻量异步信号量。
 * 产品维度：避免批量图片处理耗尽 CPU 或原生资源，同时保持任务提交顺序。
 * 逻辑维度：有空位时立即启动，否则排队；任务成功或失败都释放槽位并唤醒队首。
 * 关键边界：concurrency 必须为正数；任何拒绝值都会释放槽位，非 Error 值会被包装。
 * 新手阅读建议：先看 active 与 waiting，再沿 start、release、成功和失败分支跟踪一个任务。
 */

/** FIFO limiter for asynchronous compression work. */
/* 异步压缩工作的先进先出并发限制器；每个实例拥有独立计数和队列。 */
export class CompressionLimiter {
  // 当前占用槽位的任务数；范围为 0 到 concurrency。
  private active = 0
  // 等待启动函数的先进先出队列；数组首项是下一个获准任务。
  private readonly waiting: Array<() => void> = []

  /**
   * @param concurrency - positive maximum number of active tasks.
   */
  /* 构造限制器。@param concurrency 同时运行任务的正整数上限。@example new CompressionLimiter(2)。 */
  constructor(readonly concurrency: number) {}

  /**
   * Run one task after an instance slot becomes available.
   * @param task - compression operation occupying one slot until settlement.
   * @returns the task result.
   */
  /*
   * 获得实例槽位后运行一个任务。
   * @param task 返回 Promise 的压缩操作，直到完成都占用一个槽位。
   * @returns 与 task 相同结果类型的 Promise。
   * @example await limiter.run(() => compress(image))。
   */
  run<T>(task: () => Promise<T>): Promise<T> {
    // 新任务的外层 Promise；resolve/reject 将内部任务结果原样传给调用方。
    return new Promise<T>((resolve, reject) => {
      // 实际启动函数；可能立即调用，也可能进入 waiting 队列。
      const start = (): void => {
        this.active += 1
        // 释放当前槽位并启动队首等待任务；成功和失败路径都必须调用一次。
        const release = (): void => {
          this.active -= 1
          this.waiting.shift()?.()
        }
        void Promise.resolve().then(task).then(
          // task 成功结果；先释放槽位，再完成调用方 Promise。
          (value) => {
            release()
            resolve(value)
          },
          // task 拒绝原因；释放槽位后保留 Error，或把其他值包装为 Error。
          (error: unknown) => {
            release()
            reject(error instanceof Error
              ? error
              : new Error('Image compression task rejected with a non-Error value.', { cause: error }))
          },
        )
      }
      if (this.active < this.concurrency) start()
      else this.waiting.push(start)
    })
  }
}
