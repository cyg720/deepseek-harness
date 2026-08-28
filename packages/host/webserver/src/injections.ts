/*
 * ================================ 文件注释 ================================
 * 【文件职责】结构化 index 注入：插件贡献给启动 HTML 的类型化行，替代原始的
 * tapIndex 字符串转换。行是纯 JSON 可序列化数据，因为一张表喂两个渲染器——
 * 服务端表单把行渲染进 index.html 文本（renderIndexInjections），静态 worker
 * 部署则把同样的行随启动载荷交给页面侧解释器。
 * 【技术维度】IndexInjection 是判别联合（global/script/script-src/style/html）；
 * global 行的名字与值都做 JSON.stringify 并对 '<' 转义（防脚本元素逃逸）；
 * 文本型行的内容被约定为不得包含闭合标签序列（会提前关闭元素）。
 * 【产品维度】宿主 Web 启动页的按需注入：主题、模块图、插件脚本等可声明式
 * 注入，保证任何无法表达为行的标记仍走 tapIndex 逃生口。
 * 【逻辑维度】放置类型 → 行联合 → 属性转义/穷尽断言 → 单行渲染（renderRow）→
 * 文本拼接（splice）→ 入口（renderIndexInjections：按 head/body 分组插入）。
 * 【关键边界】head/body 标签缺失时分别采用前置/追加策略（无头夹具页、无体
 * 片段）；script/script-src 的 text/src 必须避免闭合序列；global 值 undefined
 * 渲染为字面 'undefined'。
 * 【新手阅读建议】先看 IndexInjection 五种行的语义，再看 renderRow 与
 * renderIndexInjections 的插入策略。
 * ==========================================================================
 */
/**
 * Structured index injections: the typed rows plugins contribute to the boot
 * HTML instead of raw `tapIndex` string transforms. Rows are pure
 * JSON-serializable data because one table feeds two renderers: the served
 * form renders rows into the index.html text ({@link renderIndexInjections}),
 * and a static worker deployment ships the same rows over its boot payload
 * for a page-side interpreter. Anything not expressible as a row stays on
 * `tapIndex`, which runs after row rendering.
 */

/** Document region a rendered row lands in: after the opening head or body tag. */
// 渲染行落地的文档区域：开标签 head 或 body 之后。
export type IndexInjectionPlacement = 'head' | 'body'

/** One structured index injection row. */
// 一条结构化 index 注入行：五种判别联合形态之一。
export type IndexInjection =
  /** Assign a JSON-serializable value to a `globalThis` property, ahead of later script rows. */
  // 把 JSON 可序列化值赋给一个 globalThis 属性（先于后续脚本行执行）。
  | { kind: 'global'; name: string; value: unknown }
  /** Inline classic script. `text` must not contain `</script`, which would close the element early. */
  // 内联经典脚本；text 不得包含闭合序列（会提前关闭元素）。
  | { kind: 'script'; placement: IndexInjectionPlacement; text: string }
  /**
   * External classic script, executed in table order: a parser-blocking tag
   * when served, an awaited fetch-and-execute in the worker form (whose
   * loader resolves worker-only URLs such as `/plugins/...`).
   */
  // 外部经典脚本：服务端形态是解析阻塞标签，worker 形态是先取后执行（其加载器
  // 解析 worker 专属 URL 如 /plugins/...）。
  | { kind: 'script-src'; placement: IndexInjectionPlacement; src: string }
  /** Advisory preload for an external classic script; static workers may ignore it. */
  | { kind: 'script-preload'; src: string }
  /** A `<style>` element in the head. `text` must not contain `</style`, which would close the element early. */
  // head 中的 <style> 元素；text 不得包含闭合序列。
  | { kind: 'style'; text: string }
  /** Raw markup fragment. */
  // 原始标记片段。
  | { kind: 'html'; placement: IndexInjectionPlacement; html: string }

/** Escape a row value before placing it in a quoted HTML attribute. */
// 行值放进带引号的 HTML 属性前的转义：&、"、<、> 四字符。
function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function assertNever(row: never): never {
  throw new Error(`webserver: unknown index injection row ${JSON.stringify(row)}`)
}

/** Render one row to markup with its placement. */
// 把一行渲染为带放置位置的标记：按 kind 分派五种形态。
function renderRow(row: IndexInjection): { placement: IndexInjectionPlacement; markup: string } {
  switch (row.kind) {
    case 'global': {
      // `<` is escaped in JSON so a row-controlled string cannot break out of
      // the script element.
      const name = JSON.stringify(row.name).replaceAll('<', '\\u003c')
      const value = row.value === undefined
        ? 'undefined'
        : JSON.stringify(row.value).replaceAll('<', '\\u003c')
      return { placement: 'head', markup: `<script>globalThis[${name}] = ${value}</script>` }
    }
    case 'script':
      return { placement: row.placement, markup: `<script>${row.text}</script>` }
    case 'script-src':
      return { placement: row.placement, markup: `<script src="${escapeHtmlAttribute(row.src)}"></script>` }
    case 'script-preload':
      return { placement: 'head', markup: `<link rel="preload" as="script" href="${escapeHtmlAttribute(row.src)}">` }
    case 'style':
      return { placement: 'head', markup: `<style>${row.text}</style>` }
    case 'html':
      return { placement: row.placement, markup: row.html }
    default:
      return assertNever(row)
  }
}

/** Insert `markup` into `html` at `at`. */
// 在指定下标处把标记插入 HTML 文本。
function splice(html: string, at: number, markup: string): string {
  return `${html.slice(0, at)}${markup}${html.slice(at)}`
}

/**
 * Tail script settling the boot-readiness deferred (`__DSH_BOOT_READY__`):
 * the client entry awaits its `.promise` before reading any injected state.
 * Whichever side runs first creates the deferred (`??=`), so a bootstrap that
 * applies the table asynchronously installs it ahead of the entry module and
 * settles it after the last row; the served form below creates and resolves
 * it in one statement, because every row is already in the document text.
 */
const READY_MARKUP = '<script>(globalThis.__DSH_BOOT_READY__ ??= Promise.withResolvers()).resolve()</script>'

/**
 * Render rows into an index.html body: head rows immediately after the
 * opening head tag, body rows immediately after the opening body tag, each
 * group in table order, and the boot-readiness tail after the last body row.
 * @param html - the raw index.html body.
 * @param rows - the collected injection table.
 * @returns the html with every row rendered.
 */
// 把行渲染进 index.html：head 行紧跟开 head 标签之后、body 行紧跟开 body 标签
// 之后，组内保持表顺序。无 <head> 的无头页前置、无 <body> 的片段追加到末尾。
export function renderIndexInjections(html: string, rows: readonly IndexInjection[]): string {
  let head = ''
  let body = ''
  for (const row of rows) {
    const rendered = renderRow(row)
    if (rendered.placement === 'head') head += rendered.markup
    else body += rendered.markup
  }
  body += READY_MARKUP
  let out = html
  if (head !== '') {
    const open = /<head(?:\s[^>]*)?>/i.exec(out)
    // Headless fixture pages may lack <head>; prepending keeps the rows ahead
    // of every document script.
    out = open === null ? `${head}${out}` : splice(out, open.index + open[0].length, head)
  }
  if (body !== '') {
    const open = /<body(?:\s[^>]*)?>/i.exec(out)
    // Body-less fragments receive the rows at the end, where the HTML parser
    // has already synthesized a body.
    out = open === null ? `${out}${body}` : splice(out, open.index + open[0].length, body)
  }
  return out
}
