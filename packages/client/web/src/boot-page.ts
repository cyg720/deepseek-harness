/**
 * ================================ 文件注释 ================================
 * 【文件职责】无框架启动页与失败报告：客户端插件失败时它仍可用，因为
 *   React 只随 UI 渲染器到达。
 * 【技术维度】纯 DOM 操作 + CSS 模块：进度弧以 CSS 变量旋转；状态投影
 *   来自 internal/status。
 * 【产品维度】启动阶段展示品牌字标、加载旋转弧、插件进度与失败清单，
 *   无需等待 React 挂载。
 * 【逻辑维度】构造挂 DOM；setTotal 设总数；setState 投影条目状态；
 *   fail 展示失败报告；render 重绘状态相关内容；updateProgress 单调增长
 *   进度弧；dispose 摘除。
 * 【关键边界】失败状态下替换为报告卡片（字标 + 失败项）；
 *   dispose 在渲染器接管挂载点前后均可调用。
 * 【新手阅读建议】对照 boot.ts 的调用点理解生命周期。
 * ==========================================================================
 */
/**
 * Framework-free boot page and failure report. It remains available when a
 * client plugin fails because React arrives only with the UI renderer.
 * @module @deepseek-ai/dsh-client-web/src/boot-page
 */
/**
 * 无框架启动页与失败报告：客户端插件失败时它仍可用，因为 React 只随 UI
 * 渲染器到达。
 * @module @deepseek-ai/dsh-client-web/src/boot-page
 */
import type { LoaderEntryState } from './loader-status.ts'
import css from './boot-page.module.css'

/** Create a div with one module class and optional text. */
/** 创建一个带单个模块类与可选文本的 div。 */
function div(className: string | undefined, text?: string): HTMLDivElement {
  const el = document.createElement('div')
  el.className = className ?? ''
  if (text !== undefined) el.textContent = text
  return el
}

/** Kernel-owned page mounted below the application's root element. */
/** 内核拥有的启动页，挂载在应用根元素之下。 */
export class BootPage {
  private readonly root: HTMLDivElement // 页根
  private readonly card: HTMLDivElement // 内容卡片
  private readonly wordmark: HTMLDivElement // 品牌字标
  private readonly spinner: HTMLDivElement // 进度旋转弧
  private readonly hint: HTMLDivElement // 提示文案
  private readonly states = new Map<string, LoaderEntryState>() // 条目名 -> 状态
  private readonly active = new Set<string>() // 已激活条目集合（进度分母）
  private total = 0 // 启动名册总数
  private failure: string | undefined // 启动失败报告

  /**
   * Build and attach the boot page.
   * @param container - Application mount point.
   */
  /**
   * 构建并挂载启动页。
   * @param container 应用挂载点。
   */
  constructor(container: HTMLElement) {
    this.root = div(css.boot)
    this.root.dataset.dshBoot = ''
    this.card = div(css.card)
    this.wordmark = div(css.wordmark, 'HARNESS')
    this.spinner = div(css.spinner)
    this.spinner.dataset.dshBootSpinner = ''
    this.hint = div(css.hint, 'Loading plugins…')
    this.card.append(this.wordmark, this.spinner, this.hint)
    this.root.append(this.card)
    container.append(this.root)
    this.updateProgress()
  }

  /**
   * Set the number of loader entries represented by the progress arc.
   * @param total - Complete boot roster size.
   */
  /**
   * 设置进度弧代表的 loader 条目数。
   * @param total 完整启动名册大小。
   */
  setTotal(total: number): void {
    this.total = total
    this.updateProgress()
  }

  /**
   * Project one loader entry's fiber state.
   * @param id - Loader entry name.
   * @param state - Projected fiber state.
   */
  /**
   * 投影一个 loader 条目的 fiber 状态。
   * @param id Loader 条目名。
   * @param state 投影的 fiber 状态。
   */
  setState(id: string, state: LoaderEntryState): void {
    this.states.set(id, state)
    if (state === 'active') this.active.add(id)
    this.updateProgress()
    this.render()
  }

  /**
   * Display the boot failure report.
   * @param message - Failure report text.
   */
  /**
   * 展示启动失败报告。
   * @param message 失败报告文本。
   */
  fail(message: string): void {
    this.failure = message
    this.render()
  }

  /** Detach the page before or after the UI renderer takes the mount point. */
  /** 在 UI 渲染器接管挂载点前后均可摘除本页。 */
  dispose(): void {
    this.root.remove()
  }

  /** Redraw the state-dependent content below the wordmark. */
  /** 重绘字标下方的状态相关内容。 */
  private render(): void {
    const failed = [...this.states].filter(([, state]) => state === 'failed').map(([id]) => id)
    if (this.failure === undefined && failed.length === 0) {
      if (this.spinner.parentElement !== this.card) {
        this.card.replaceChildren(this.wordmark, this.spinner, this.hint)
      }
      return
    }
    const report = div(css.failed)
    report.append(div(css.failedTitle, 'Failed to load plugins'))
    for (const id of failed) report.append(div(css.failedItem, id))
    if (this.failure !== undefined) report.append(div(css.failedItem, this.failure))
    this.card.replaceChildren(this.wordmark, report)
  }

  /** Grow the rotating arc monotonically as loader entries activate. */
  /** 随 loader 条目激活单调增长旋转弧。 */
  private updateProgress(): void {
    const ratio = this.total === 0 ? 0 : Math.min(this.active.size / this.total, 1)
    this.spinner.style.setProperty('--dsh-boot-arc', `${String(Math.round(72 + ratio * 216))}deg`)
  }
}
