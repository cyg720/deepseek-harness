/**
 * Composer keymap over the Lexical command layer: menu arbitration
 * (arrows/escape/enter), space adjudication, the Enter submit gesture, and
 * paste routing. Registered at CRITICAL priority so it decides before
 * @lexical/plain-text's own Enter/paste defaults; a handler returning false
 * falls through to those defaults (Shift+Enter's line break, ordinary
 * spaces, text paste the bar routes itself).
 *
 * IME guard: a composition-closing Enter/Space must not submit or adjudicate.
 * KeyboardEvent.isComposing covers most engines; Safari delivers the closing
 * keydown AFTER compositionend, so a root-element composition watch holds the
 * guard for 10ms more (the old textarea's proven window); keyCode
 * 229 is the legacy signal engines emit without isComposing.
 * @remarks 文件说明：文件职责：实现 client/ui-conversation 中 keymap 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * client/ui-conversation 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */
import type { LexicalEditor } from 'lexical'
import {
  COMMAND_PRIORITY_CRITICAL, KEY_ARROW_DOWN_COMMAND, KEY_ARROW_UP_COMMAND, KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND, KEY_SPACE_COMMAND, KEY_TAB_COMMAND, PASTE_COMMAND,
} from 'lexical'
import { mergeRegister } from '@lexical/utils'
import type { ArbitrateKey, ArbitrateOutcome } from '../../contract/input.ts'

/** The bar-supplied behavior behind each intercepted gesture. */
export interface ComposerKeymapHandlers {
  /** Keyboard arbitration while the menu is open ('pass' when no pipeline).
   * @remarks 中文说明：功能说明：处理 arbitrate 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：key（ArbitrateKey）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：composing（boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：ArbitrateOutcome；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * arbitrate(key, composing)，并按返回类型处理结果。 */
  arbitrate(key: ArbitrateKey, composing: boolean): ArbitrateOutcome
  /** Space adjudication; true = a claim was applied — the keystroke is consumed.
   * @remarks 中文说明：功能说明：处理 space 相关流程；使用场景由所在模块及调用位置决定。；返回值：boolean；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 space()，并按返回类型处理结果。 */
  space(): boolean
  /** Dismiss the popupSelect shell (Escape layering: an open overlay closes first).
   * @remarks 中文说明：功能说明：处理 dismissPopup 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 dismissPopup()，并按返回类型处理结果。 */
  dismissPopup(): void
  /** Whether Enter may submit right now (locked/busy states refuse).
   * @remarks 中文说明：功能说明：判断是否能够 Submit 相关流程；使用场景由所在模块及调用位置决定。；返回值：boolean；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 canSubmit()，并按返回类型处理结果。 */
  canSubmit(): boolean
  /** The Enter gesture after every guard passed; `accelerated` = Ctrl/Cmd held.
   * @remarks 中文说明：功能说明：处理 submit 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：accelerated（boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 submit(accelerated)，
   * 并按返回类型处理结果。 */
  submit(accelerated: boolean): void
  /** Pasted files (image intake).
   * @remarks 中文说明：功能说明：处理 intakeFiles 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：files（readonly File[]）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 intakeFiles(files)，
   * 并按返回类型处理结果。 */
  intakeFiles(files: readonly File[]): void
  /** Pasted plain text (sanitized insertion through the shell).
   * @remarks 中文说明：功能说明：处理 pasteText 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：text（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 pasteText(text)，并按返回类型处理结果。 */
  pasteText(text: string): void
}

/** Composition state a keydown can trust (see the module doc's Safari note).
 * @remarks 中文说明：功能说明：判断是否为 Composing Event 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：event（KeyboardEvent）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：recentlyComposing（() => boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：boolean；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * isComposingEvent(event, recentlyComposing)，并按返回类型处理结果。 */
function isComposingEvent(event: KeyboardEvent, recentlyComposing: () => boolean): boolean {
  // keyCode 229 is the legacy IME-composition signal engines emit without isComposing.
  // oxlint-disable-next-line typescript/no-deprecated
  return event.isComposing || event.keyCode === 229 || recentlyComposing()
}

/**
 * Register the composer keymap on one editor.
 * @param editor - the shell-owned editor.
 * @param handlers - bar-supplied behavior.
 * @returns the unregister disposer.
 * @remarks 中文说明：功能说明：注册 Composer Keymap 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：editor（LexicalEditor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：handlers（ComposerKeymapHandlers）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。
 * ；返回值：() => void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * registerComposerKeymap(editor, handlers)，并按返回类型处理结果。
 */
export function registerComposerKeymap(editor: LexicalEditor, handlers: ComposerKeymapHandlers): () => void {
  // Composition watch: true through composition and for one tick after
  // compositionend (Safari's late closing keydown). The listener rides the
  // root element and re-arms on root swaps.
  /**
   * 变量说明：composing 用于处理 composing 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let composing = false
  /**
   * 变量说明：composingUntil 用于处理 composingUntil 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let composingUntil = 0
  /**
   * 常量说明：onCompositionStart 用于响应 Composition Start 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   * 功能说明：响应 Composition Start 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 onCompositionStart()，并按返回类型处理结果。
   */
  const onCompositionStart = (): void => {
    composing = true
  }
  /**
   * 常量说明：onCompositionEnd 用于响应 Composition End 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   * 功能说明：响应 Composition End 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 onCompositionEnd()，并按返回类型处理结果。
   */
  const onCompositionEnd = (): void => {
    composing = false
    composingUntil = Date.now() + 10
  }
  /**
   * 常量说明：recentlyComposing 用于处理 recentlyComposing 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 recentlyComposing 相关流程；使用场景由所在模块及调用位置决定。
   * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 recentlyComposing()，并按返回类型处理结果。
   */
  const recentlyComposing = (): boolean => composing || Date.now() < composingUntil

  /**
   * 常量说明：arrow 用于处理 arrow 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 arrow 相关流程；使用场景由所在模块及调用位置决定。
   * @param key （ArbitrateKey）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 arrow(key)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（KeyboardEvent |
   * null）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：boolean；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
   */
  const arrow = (key: ArbitrateKey) => (event: KeyboardEvent | null): boolean => {
    /**
     * 常量说明：inComposition 用于处理 inComposition 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const inComposition = event !== null && isComposingEvent(event, recentlyComposing)
    if (handlers.arbitrate(key, inComposition) === 'consumed') {
      event?.preventDefault()
      return true
    }
    return false
  }

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：root（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：prevRoot（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(root, prevRoot)，
   * 并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
   * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
   * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
   * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
   * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
   */
  return mergeRegister(
    editor.registerRootListener((root, prevRoot) => {
      prevRoot?.removeEventListener('compositionstart', onCompositionStart)
      prevRoot?.removeEventListener('compositionend', onCompositionEnd)
      root?.addEventListener('compositionstart', onCompositionStart)
      root?.addEventListener('compositionend', onCompositionEnd)
    }),
    editor.registerCommand(KEY_ARROW_UP_COMMAND, arrow('up'), COMMAND_PRIORITY_CRITICAL),
    editor.registerCommand(KEY_ARROW_DOWN_COMMAND, arrow('down'), COMMAND_PRIORITY_CRITICAL),
    // Tab drills into a drillable highlighted row; otherwise it passes so the
    // browser keeps its native focus traversal.
    editor.registerCommand(KEY_TAB_COMMAND, arrow('tab'), COMMAND_PRIORITY_CRITICAL),
    editor.registerCommand(KEY_ESCAPE_COMMAND, (event) => {
      // Escape layering: an open overlay closes; claimed without an overlay
      // does NOT release (backspacing the token is the only exit gesture).
      handlers.dismissPopup()
      if (handlers.arbitrate('escape', isComposingEvent(event, recentlyComposing)) === 'consumed') {
        event.preventDefault()
        return true
      }
      return false
    }, COMMAND_PRIORITY_CRITICAL),
    editor.registerCommand(KEY_SPACE_COMMAND, (event) => {
      if (isComposingEvent(event, recentlyComposing)) return false
      /**
       * 常量说明：consumed 用于处理 consumed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const consumed = handlers.space()
      if (consumed) {
        event.preventDefault() // claim token already carries the trailing separator
        return true
      }
      return false
    }, COMMAND_PRIORITY_CRITICAL),
    editor.registerCommand(KEY_ENTER_COMMAND, (event) => {
      // Shift+Enter is the native line break UNCONDITIONALLY — decided before
      // the IME guard so a composition-closing Shift+Enter still breaks the line.
      if (event?.shiftKey === true) return false
      if (event !== null && isComposingEvent(event, recentlyComposing)) {
        // The IME consumes this Enter (candidate pick); neither submit nor
        // break the line. No preventDefault: the browser owns the gesture.
        return true
      }
      // Menu-open Enter picks the highlight through arbitration; a
      // no-highlight menu passes down to the submit gesture.
      if (handlers.arbitrate('enter', false) !== 'pass') {
        event?.preventDefault()
        return true
      }
      event?.preventDefault()
      if (event?.repeat === true) return true // held-down Enter must not machine-gun sends
      if (!handlers.canSubmit()) return true
      handlers.submit(event?.ctrlKey === true || event?.metaKey === true)
      return true
    }, COMMAND_PRIORITY_CRITICAL),
    editor.registerCommand(PASTE_COMMAND, (event) => {
      // Duck-typed: the payload union includes InputEvent, and test engines
      // deliver clipboardData on plain events.
      /**
       * 常量说明：clipboardData 用于处理 clipboardData 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const clipboardData = (event as ClipboardEvent).clipboardData ?? null
      if (clipboardData === null) return false
      /**
       * 常量说明：files 用于处理 files 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：file（由 TypeScript
       * 根据调用位置推断的类型）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：file is File；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(file)，并按返回类型处理结果。
       */
      const files = Array.from(clipboardData.items)
        .filter(item => item.kind === 'file')
        .map(item => item.getAsFile())
        .filter((file): file is File => file !== null)
      if (files.length > 0) handlers.intakeFiles(files)
      /**
       * 常量说明：text 用于处理 text 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const text = clipboardData.getData('text/plain')
      if (text === '') {
        if (files.length === 0) return false
        event.preventDefault()
        return true
      }
      event.preventDefault()
      handlers.pasteText(text)
      return true
    }, COMMAND_PRIORITY_CRITICAL),
  )
}
