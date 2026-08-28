// @vitest-environment jsdom

/**
 * 文件职责：验证 experimental/webworker-runtime 中 source chooser spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PreviewFixtureManifest } from '../../src/fixture-manifest.ts'
import { choosePreviewSource } from '../../src/client/source-chooser.ts'

/**
 * 常量说明：MANIFEST_URL 用于处理 MANIFEST_URL 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const MANIFEST_URL = new URL('https://preview.test/preview/fixtures.json')

/**
 * 常量说明：MANIFEST 用于处理 MANIFEST 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const MANIFEST: PreviewFixtureManifest = {
  version: 1,
  defaultFixture: 'example',
  fixtures: [{
    id: 'example',
    label: 'Example & <demo> "quoted" \'single\'',
    description: 'A deterministic example.',
    overlays: ['fixtures/base.tar.gz', 'fixtures/tail.tar.gz'],
  }],
}

/**
 * 功能说明：设置 Location 相关流程；使用场景由所在模块及调用位置决定。
 * @param search （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 setLocation(search)，并按返回类型处理结果。
 */
function setLocation(search = ''): void {
  history.replaceState({}, '', `/preview.html${search}`)
}

/**
 * 功能说明：处理 installManifest 相关流程；使用场景由所在模块及调用位置决定。
 * @param manifest （PreviewFixtureManifest）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns ReturnType<typeof vi.fn>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 installManifest(manifest)，并按返回类型处理结果。
 */
function installManifest(manifest: PreviewFixtureManifest = MANIFEST): ReturnType<typeof vi.fn> {
  /**
   * 常量说明：fetch 用于请求 fetch 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const fetch = vi.fn(async () => Response.json(manifest))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

/**
 * 功能说明：处理 submitChooser 相关流程；使用场景由所在模块及调用位置决定。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 submitChooser()，并按返回类型处理结果。
 */
function submitChooser(): void {
  /**
   * 常量说明：form 用于处理 form 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const form = document.querySelector<HTMLFormElement>('[data-preview-source-card]')
  if (form === null) throw new Error('test chooser form was not rendered')
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('Preview source chooser', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  beforeEach(() => {
    document.head.replaceChildren()
    document.body.innerHTML = '<div id="root"></div>'
    setLocation()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('bypasses the chooser and manifest for an explicit empty source', async () => {
    setLocation('?preview-fixture=none')
    /**
     * 常量说明：fetch 用于请求 fetch 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const fetch = installManifest()

    await expect(choosePreviewSource(MANIFEST_URL)).resolves.toEqual([])
    expect(fetch).not.toHaveBeenCalled()
    expect(document.querySelector('[data-preview-source-chooser]')).toBeNull()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('bypasses the chooser and resolves an explicit built-in fixture', async () => {
    document.body.replaceChildren()
    setLocation('?preview-fixture=example')
    /**
     * 常量说明：fetch 用于请求 fetch 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const fetch = installManifest()

    await expect(choosePreviewSource(MANIFEST_URL)).resolves.toEqual([
      new URL('https://preview.test/preview/fixtures/base.tar.gz'),
      new URL('https://preview.test/preview/fixtures/tail.tar.gz'),
    ])
    expect(fetch).toHaveBeenCalledOnce()
    expect(document.querySelector('[data-preview-source-chooser]')).toBeNull()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：source（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(source)，并按返回类型处理结果。
   */
  it.each(['', 'missing', 'webfs'])(
    'fails loud for the explicit unavailable source %j without opening the chooser',
    async (source) => {
      setLocation(`?preview-fixture=${source}`)
      installManifest()

      await expect(choosePreviewSource(MANIFEST_URL)).rejects.toThrow(/unknown or interactive source/)
      expect(document.querySelector('[data-preview-source-chooser]')).toBeNull()
    },
  )

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('shows the chooser only when the query is absent and returns its default selection', async () => {
    installManifest()
    /**
     * 常量说明：root 用于处理 root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const root = document.getElementById('root')
    if (root === null) throw new Error('test root is missing')
    /**
     * 常量说明：bootPage 用于处理 bootPage 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const bootPage = document.createElement('div')
    bootPage.dataset.dshBoot = ''
    root.append(bootPage)

    /**
     * 常量说明：selected 用于处理 selected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const selected = choosePreviewSource(MANIFEST_URL)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => {
      expect(document.querySelector('[data-preview-source-chooser]')).not.toBeNull()
    })
    expect(document.querySelector<HTMLInputElement>('input[value="example"]')?.checked).toBe(true)
    expect(document.querySelector<HTMLInputElement>('input[value="webfs"]')?.disabled).toBe(true)
    expect(document.querySelector('[data-preview-source-card]')?.textContent)
      .toContain(MANIFEST.fixtures[0]?.label)
    expect(document.querySelector('[data-preview-source-card] script')).toBeNull()

    submitChooser()

    await expect(selected).resolves.toEqual([
      new URL('https://preview.test/preview/fixtures/base.tar.gz'),
      new URL('https://preview.test/preview/fixtures/tail.tar.gz'),
    ])
    expect(root.contains(bootPage)).toBe(true)
    expect(root.childElementCount).toBe(1)
    expect(document.querySelector('[data-preview-source-chooser]')).toBeNull()
    expect(document.querySelector('[data-preview-source-style]')).toBeNull()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('selects the empty source when the manifest has no default', async () => {
    installManifest({ ...MANIFEST, defaultFixture: null })

    /**
     * 常量说明：selected 用于处理 selected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const selected = choosePreviewSource(MANIFEST_URL)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => {
      expect(document.querySelector<HTMLInputElement>('input[value="none"]')?.checked).toBe(true)
    })
    submitChooser()

    await expect(selected).resolves.toEqual([])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('reports manifest, mount, form, selection, and catalog failures', async () => {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    vi.stubGlobal('fetch', vi.fn(async () => new Response('missing', { status: 404 })))
    await expect(choosePreviewSource(MANIFEST_URL)).rejects.toThrow(/returned 404/)

    installManifest()
    document.body.replaceChildren()
    await expect(choosePreviewSource(MANIFEST_URL)).rejects.toThrow(/missing #root/)

    document.body.innerHTML = '<div id="root"></div>'
    /**
     * 常量说明：root 用于处理 root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const root = document.getElementById('root')
    if (root === null) throw new Error('test root is missing')
    /**
     * 常量说明：querySelector 用于处理 querySelector 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const querySelector = vi.spyOn(HTMLElement.prototype, 'querySelector').mockReturnValueOnce(null)
    await expect(choosePreviewSource(MANIFEST_URL)).rejects.toThrow(/form was not rendered/)
    querySelector.mockRestore()

    document.head.replaceChildren()
    document.body.innerHTML = '<div id="root"></div>'
    /**
     * 常量说明：missingSelection 用于处理 missingSelection 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const missingSelection = choosePreviewSource(MANIFEST_URL)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => { expect(document.querySelector('form')).not.toBeNull() })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：input（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(input)，并按返回类型处理结果。
     */
    document.querySelectorAll('input[name="preview-source"]').forEach((input) => {
      input.removeAttribute('name')
    })
    submitChooser()
    await expect(missingSelection).rejects.toThrow(/no source selected/)

    document.head.replaceChildren()
    document.body.innerHTML = '<div id="root"></div>'
    /**
     * 常量说明：unavailableSelection 用于处理 unavailableSelection 相关数据，作用于当前作用域；
     * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const unavailableSelection = choosePreviewSource(MANIFEST_URL)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => { expect(document.querySelector('form')).not.toBeNull() })
    /**
     * 常量说明：selected 用于处理 selected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const selected = document.querySelector<HTMLInputElement>('input:checked')
    if (selected === null) throw new Error('test selection is missing')
    selected.value = 'missing'
    submitChooser()
    await expect(unavailableSelection).rejects.toThrow(/unavailable source/)
  })
})
