/*
 * ================================ 文件注释 ================================
 * 【文件职责】为 dsh-llm 包提供"穷尽性断言"工具函数 assertNever，用于在
 * 封闭联合类型（closed union，即所有成员都定义在本包内、不会被外部扩展的
 * 类型）的 switch 默认分支上拦截"按设计不可能发生"的代码路径。
 * 【技术维度】依赖 TypeScript 的 never 类型做编译期穷尽性检查：参数被声明为
 * never 后，任何未处理的新类型变体都会在调用处直接编译报错，从而把"漏处理
 * 新变体"的问题提前暴露在编译期而不是留到运行时。
 * 【产品维度】harness 的 LLM 消息流包含多种块类型、结束原因等联合类型，会随
 * 版本演进不断增加新变体；该工具保证所有处理点必须显式处理每个变体，避免新
 * 类型被静默忽略引发线上异常。属于内部工程质量约定，不直接面向用户。
 * 【逻辑维度】单函数文件。assertNever 先把传入值做 JSON 序列化（对 undefined
 * 等不可序列化值用 String 兜底），再抛出带可选上下文标签的 Error，便于定位。
 * 【关键边界】仅适用于封闭联合类型（如 StreamChunk、FinishReason）；对声明
 * 合并（declaration merging，插件可扩展）的联合类型（如会话事件、内容块）不
 * 可使用，因为插件可能增加合法的新变体，此时应显式处理已知变体并留默认分支。
 * 【新手阅读建议】全文很短，直接通读即可；重点理解"为什么参数类型是 never"
 * 以及它和可扩展联合类型的区别。
 * ==========================================================================
 */

/**
 * Exhaustiveness helper for closed core unions. Use {@link assertNever} at the default branch so a
 * new variant fails compilation at every required handler. Do not use it for declaration-merged
 * unions such as session events or content blocks: handle known variants and explicitly fall
 * through because plugins may add valid unknown cases.
 * @module @deepseek-ai/dsh-llm/never
 */

/**
 * Mark an unreachable closed-union branch. A newly unhandled typed variant fails at the call site;
 * a value that escaped its type throws with diagnostics at runtime.
 * @param value - the impossible value; typed `never` so an unhandled variant fails compilation at the call site.
 * @param context - optional label (e.g. the switch site) prefixed into the throw message.
 * @returns never — it always throws, with the offending value JSON-rendered in the message.
 */
/*
 * （中文）对"按类型系统本不该到达"的分支抛出异常：一旦未来给某个封闭联合
 * 类型新增了变体，而某处 switch 没有处理它，编译期就会因为实参类型不再是
 * never 而直接报错；若是有值在运行时逃逸了类型检查，则在这里带诊断信息抛出。
 * @param value 不可能出现的值；类型为 never，因此未处理的新变体在编译期即失败。
 * @param context 可选标签（例如 switch 所在位置），会拼进抛错信息便于定位。
 * @returns 永不返回——总是抛出异常，消息中会以 JSON 形式渲染出错值。
 */
export function assertNever(value: never, context?: string): never {
  // JSON.stringify is typed string but returns undefined for undefined input;
  // String() covers that and other non-serializable escapes.
  // 中文：JSON.stringify 的静态返回类型是 string，但遇到 undefined 输入时实际
  // 会返回 undefined；String() 可以兜底这种情况以及其他无法序列化的逃逸值。
  const rendered = (JSON.stringify(value) as string | undefined) ?? String(value)
  throw new Error(`unreachable variant${context ? ` in ${context}` : ''}: ${rendered}`)
}
