/** Pre-boot filesystem-source chooser for static WebWorker previews.
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 source chooser
 * 模块的职责，并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与
 * Cordis 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import {
  parsePreviewFixtureManifest, type PreviewFixtureManifestEntry,
} from '../fixture-manifest.ts'

/**
 * 常量说明：EMPTY_SOURCE 用于处理 EMPTY_SOURCE 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const EMPTY_SOURCE = 'none'
/**
 * 常量说明：WEBFS_SOURCE 用于处理 WEBFS_SOURCE 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const WEBFS_SOURCE = 'webfs'
/**
 * 常量说明：PREVIEW_FIXTURE_QUERY 用于处理 PREVIEW_FIXTURE_QUERY 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const PREVIEW_FIXTURE_QUERY = 'preview-fixture'

interface PreviewSourceChoice {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly overlays: readonly URL[]
  readonly disabled?: boolean
}

/**
 * 常量说明：CHOOSER_STYLE 用于处理 CHOOSER_STYLE 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const CHOOSER_STYLE = `
  [data-preview-source-chooser] {
    position: fixed;
    inset: 0;
    z-index: 1200;
    display: grid;
    place-items: center;
    overflow: auto;
    padding: 24px;
    box-sizing: border-box;
    color: #0f1115;
    background: #fff;
    font-size: 14px;
    line-height: 22px;
  }
  [data-preview-source-card] {
    width: min(600px, 100%);
    max-height: calc(100dvh - 48px);
    box-sizing: border-box;
    padding: 28px;
    overflow-y: auto;
    border: 1px solid transparent;
    border-radius: 24px;
    background: #fff;
    box-shadow: 0 0 1px rgb(0 0 0 / 20%), 0 12px 32px rgb(0 0 0 / 8%);
  }
  [data-preview-source-card] h1 {
    margin: 0;
    font-size: 20px;
    line-height: 28px;
    font-weight: 500;
  }
  [data-preview-source-card] > p {
    margin: 8px 0 0;
    color: #61666b;
  }
  [data-preview-source-card] fieldset {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin: 24px 0 0;
    padding: 0;
    border: 0;
  }
  [data-preview-source-card] legend {
    margin: 0 0 8px;
    padding: 0 4px;
    color: #61666b;
    font-size: 13px;
    line-height: 20px;
    font-weight: 500;
  }
  [data-preview-source-option] {
    position: relative;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    min-height: 56px;
    padding: 8px 12px 8px 8px;
    box-sizing: border-box;
    border: 1px solid transparent;
    border-radius: 12px;
    background: transparent;
    cursor: pointer;
    transition: background-color 120ms ease, border-color 120ms ease;
  }
  [data-preview-source-option]:hover:not(:has(input:disabled)),
  [data-preview-source-option]:has(input:checked) {
    background: rgb(38 49 72 / 6%);
  }
  [data-preview-source-option]:has(input:checked) {
    border-color: rgb(0 0 0 / 10%);
  }
  [data-preview-source-option]:has(input:disabled) {
    cursor: default;
    opacity: 0.4;
  }
  [data-preview-source-option] input {
    flex: none;
    width: 16px;
    height: 16px;
    margin: 4px 0 0;
    accent-color: #0f1115;
  }
  [data-preview-source-option] > span { flex: 1; min-width: 0; }
  [data-preview-source-option] strong {
    display: block;
    font-size: 14px;
    line-height: 24px;
    font-weight: 500;
  }
  [data-preview-source-option] strong + span {
    display: block;
    color: #81858c;
    font-size: 14px;
    line-height: 24px;
  }
  [data-preview-source-submit] {
    display: block;
    min-width: 120px;
    height: 36px;
    margin: 24px 0 0 auto;
    padding: 0 14px;
    border: 0;
    border-radius: 18px;
    color: #fff;
    background: #0f1115;
    font-size: 14px;
    line-height: 22px;
    cursor: pointer;
    transition: background-color 120ms ease;
  }
  [data-preview-source-submit]:hover:not(:disabled) {
    background: #43454a;
  }
  [data-preview-source-submit]:focus-visible {
    outline: 2px solid rgb(0 0 0 / 16%);
    outline-offset: 2px;
  }
  [data-preview-source-submit]:disabled { cursor: not-allowed; opacity: 0.5; }
  @media (prefers-color-scheme: dark) {
    [data-preview-source-chooser] {
      color: #f9fafb;
      background: #151517;
    }
    [data-preview-source-card] { border-color: rgb(255 255 255 / 6%); background: #2c2c2e; }
    [data-preview-source-card] > p, [data-preview-source-card] legend { color: #cfd3d6; }
    [data-preview-source-option] strong + span { color: #adb2b8; }
    [data-preview-source-option]:hover:not(:has(input:disabled)),
    [data-preview-source-option]:has(input:checked) { background: rgb(255 255 255 / 8%); }
    [data-preview-source-option]:has(input:checked) { border-color: rgb(255 255 255 / 12%); }
    [data-preview-source-option] input { accent-color: #f9fafb; }
    [data-preview-source-submit] { color: #0f1115; background: #f9fafb; }
    [data-preview-source-submit]:hover:not(:disabled) { background: #ebeef2; }
    [data-preview-source-submit]:focus-visible { outline-color: rgb(255 255 255 / 20%); }
  }
  @media (max-width: 560px) {
    [data-preview-source-card] { padding: 24px; }
    [data-preview-source-submit] { width: 100%; }
  }
  @media (prefers-reduced-motion: reduce) {
    [data-preview-source-option], [data-preview-source-submit] { transition: none; }
  }
`

/**
 * 常量说明：ENTITIES 用于处理 ENTITIES 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const ENTITIES: Readonly<Record<string, string>> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}

/**
 * 功能说明：处理 escapeMarkup 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 escapeMarkup(value)，并按返回类型处理结果。
 */
function escapeMarkup(value: string): string {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：character（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(character)，并按返回类型处理结果。
   */
  return value.replace(/[&<>"']/g, character => ENTITIES[character] ?? character)
}

/**
 * 功能说明：处理 optionMarkup 相关流程；使用场景由所在模块及调用位置决定。
 * @param choice （PreviewSourceChoice）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param selected （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 optionMarkup(choice, selected)，并按返回类型处理结果。
 */
function optionMarkup(choice: PreviewSourceChoice, selected: string): string {
  return `<label data-preview-source-option>
    <input type="radio" name="preview-source" value="${choice.id}"${choice.id === selected ? ' checked' : ''}${choice.disabled === true ? ' disabled' : ''}>
    <span>
      <strong>${escapeMarkup(choice.label)}</strong>
      <span>${escapeMarkup(choice.description)}</span>
    </span>
  </label>`
}

/**
 * 功能说明：处理 fixtureChoices 相关流程；使用场景由所在模块及调用位置决定。
 * @param entries （readonly PreviewFixtureManifestEntry[]）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @param manifestUrl （URL）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns PreviewSourceChoice[]；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 fixtureChoices(entries, manifestUrl)，并按返回类型处理结果。
 */
function fixtureChoices(entries: readonly PreviewFixtureManifestEntry[], manifestUrl: URL): PreviewSourceChoice[] {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：entry（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(entry)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：overlay（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(overlay)，并按返回类型处理结果。
   */
  return entries.map(entry => ({
    id: entry.id,
    label: entry.label,
    description: entry.description,
    overlays: entry.overlays.map(overlay => new URL(overlay, manifestUrl)),
  }))
}

/**
 * Render the source chooser and wait for an enabled selection.
 * @param manifestUrl - Built-in fixture catalog URL.
 * @returns Ordered overlay URLs selected for the Worker mount.
 * @remarks 中文说明：功能说明：处理 choosePreviewSource 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：manifestUrl（URL）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<readonly
 * URL[]>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * choosePreviewSource(manifestUrl)，并按返回类型处理结果。
 */
export async function choosePreviewSource(manifestUrl: URL): Promise<readonly URL[]> {
  /**
   * 常量说明：requested 用于处理 requested 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const requested = new URL(location.href).searchParams.get(PREVIEW_FIXTURE_QUERY)
  if (requested === EMPTY_SOURCE) return []

  /**
   * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const response = await fetch(manifestUrl)
  if (!response.ok) {
    throw new Error(`preview source chooser: fixture manifest returned ${String(response.status)}`)
  }
  /**
   * 常量说明：manifest 用于处理 manifest 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const manifest = parsePreviewFixtureManifest(await response.json())
  /**
   * 常量说明：choices 用于处理 choices 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const choices: PreviewSourceChoice[] = [
    {
      id: EMPTY_SOURCE,
      label: 'Empty environment',
      description: 'Load only the base runtime to verify first launch and workspace creation.',
      overlays: [],
    },
    ...fixtureChoices(manifest.fixtures, manifestUrl),
    {
      id: WEBFS_SOURCE,
      label: 'WebFS directory',
      description: 'Requires directory access and will be available after the WebFS provider lands.',
      overlays: [],
      disabled: true,
    },
  ]
  if (requested !== null) {
    /**
     * 常量说明：requestedChoice 用于处理 requestedChoice 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：choice（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(choice)，并按返回类型处理结果。
     */
    const requestedChoice = choices.find(choice => choice.id === requested && choice.disabled !== true)
    if (requestedChoice === undefined) {
      throw new Error(`preview source chooser: unknown or interactive source "${requested}"`)
    }
    return requestedChoice.overlays
  }

  /**
   * 常量说明：root 用于处理 root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const root = document.getElementById('root')
  if (root === null) throw new Error('preview source chooser: missing #root')
  /**
   * 常量说明：selected 用于处理 selected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const selected = manifest.defaultFixture ?? EMPTY_SOURCE
  /**
   * 常量说明：style 用于处理 style 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const style = document.createElement('style')
  style.dataset.previewSourceStyle = ''
  style.textContent = CHOOSER_STYLE
  document.head.append(style)

  /**
   * 常量说明：chooser 用于处理 chooser 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const chooser = document.createElement('main')
  chooser.dataset.previewSourceChooser = ''
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：choice（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(choice)，并按返回类型处理结果。
   */
  chooser.innerHTML = `<form data-preview-source-card aria-labelledby="preview-source-title">
      <h1 id="preview-source-title">Choose Preview data</h1>
      <p>Data mounts before the Worker and application start. Refresh to choose again.</p>
      <fieldset>
        <legend>Filesystem source</legend>
        ${choices.map(choice => optionMarkup(choice, selected)).join('')}
      </fieldset>
      <button data-preview-source-submit type="submit">Start Preview</button>
    </form>`
  root.prepend(chooser)
  /**
   * 常量说明：form 用于处理 form 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const form = chooser.querySelector<HTMLFormElement>('[data-preview-source-card]')
  if (form === null) throw new Error('preview source chooser: form was not rendered')
  /**
   * 常量说明：sourceId 用于处理 sourceId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reject（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve, reject)，
   * 并按返回类型处理结果。
   */
  const sourceId = await new Promise<string>((resolve, reject) => {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
     */
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      /**
       * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const value = new FormData(form).get('preview-source')
      if (typeof value === 'string') resolve(value)
      else reject(new Error('preview source chooser: no source selected'))
    }, { once: true })
  })
  /**
   * 常量说明：choice 用于处理 choice 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：candidate（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(candidate)，并按返回类型处理结果。
   */
  const choice = choices.find(candidate => candidate.id === sourceId && candidate.disabled !== true)
  if (choice === undefined) throw new Error(`preview source chooser: unavailable source "${sourceId}"`)
  chooser.remove()
  style.remove()
  return choice.overlays
}
