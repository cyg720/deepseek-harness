// @vitest-environment jsdom
// Local submission echo over the BUILT client graph (keyless fixture Connection RPC
// transport): a text-plus-image send paints its echo bubble synchronously on
// the submit keystroke — before serialization, transport, or the fixture's
// durable admission — with the composer already cleared and editable, and the
// durable user/message replaces the echo without a duplicate. The fixture host
// echoes the prompt requestId as the durable source's rpcId, so the retirement
// path here is the production correlation, not a test hook.
/**
 * 文件职责：验证 apps/web 中 submission echo e2e 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'
import { installAssembledBootEnv, mountAssembledApp } from './assembled-boot.ts'

installAssembledBootEnv()

it('paints the submission echo on the send keystroke and swaps it for the durable node', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
    mountAssembledApp()

    /**
   * 常量说明：tree 用于处理 tree 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
    const tree = await screen.findByRole('tree', { name: 'Sessions' }, { timeout: 10_000 })
    /**
   * 常量说明：start 用于启动 start 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
    const start = tree.querySelector<HTMLButtonElement>('button[aria-label="New session in fixture"]')
    if (start === null) throw new Error('fixture Workspace new-session action missing')
    fireEvent.click(start)

    /**
   * 常量说明：composer 用于处理 composer 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
    const composer = await waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
        /**
     * 常量说明：surface 用于处理 surface 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const surface = document.querySelector<HTMLElement>('[data-composer-input]')
        if (surface === null) throw new Error('composer surface missing')
        return surface
      }, { timeout: 10_000 })
    /**
   * 常量说明：image 用于处理 image 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
    const image = new File([new Uint8Array([137, 80, 78, 71])], 'echoed.png', { type: 'image/png' })
    fireEvent.paste(composer, {
      clipboardData: {
        items: [{ kind: 'file', type: 'image/png', getAsFile: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => image }],
        getData: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => '',
      },
    })
    await waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
        if (document.querySelector('[role="group"][aria-label="Pending images"] img') === null) {
          throw new Error('attachment rail missing')
        }
      }, { timeout: 5_000 })
    fireEvent.paste(composer, {
      clipboardData: { items: [], getData: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => '回显这条消息' },
    })
    await waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(composer.textContent).toBe('回显这条消息') })
    fireEvent.keyDown(composer, { key: 'Enter' })

    // Synchronously after the keystroke: the echo bubble is in the flow with
    // the draft text and the object-URL preview, while the prompt has not even
    // been serialized yet (it starts after a paint yield). The composer is
    // already cleared, editable, and free of the rail.
    /**
   * 常量说明：echo 用于处理 echo 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
    const echo = document.querySelector<HTMLElement>('[data-submission-echo]')
    if (echo === null) throw new Error('submission echo missing on the send keystroke')
    expect(echo.textContent).toContain('回显这条消息')
    expect(echo.querySelector('img')?.getAttribute('src')?.split(':')[0]).toBe('blob')
    expect(composer.textContent).toBe('')
    expect(composer.getAttribute('contenteditable')).toBe('true')
    expect(document.querySelector('[role="group"][aria-label="Pending images"]')).toBeNull()

    // The fixture's durable user/message (source.rpcId echoes the prompt
    // requestId) replaces the echo: one bubble, no marker left, and the image
    // now renders from the durable gallery.
    await waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
        if (document.querySelector('[data-submission-echo]') !== null) {
          throw new Error('submission echo still present after the durable node arrived')
        }
      }, { timeout: 10_000 })
    expect(screen.getAllByText('回显这条消息')).toHaveLength(1)
    await waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
        if (document.querySelector('[data-align="end"] img') === null) {
          throw new Error('durable user gallery missing')
        }
      }, { timeout: 10_000 })
  })
