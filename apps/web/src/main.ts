/**
 * Web application entry: thin bootstrap over the shell library. Everything —
 * module-table seeding, the boot page, and the UI-renderer handoff — lives
 * in @deepseek-ai/dsh-client-web; this file only finds the mount point.
 */
/*
 * 文件职责：定位 Web 页面根节点，并启动客户端 Web 外壳。
 * 技术维度：使用浏览器 DOM API 与 `AppWebEntry` 异步启动流程。
 * 产品维度：把静态 HTML 根节点连接到完整的 DeepSeek Harness Web 应用。
 * 逻辑维度：查找 `#root`、缺失时立即报错、存在时创建入口并运行。
 * 关键边界：模块表、启动页和渲染器交接由客户端 Web 包负责，本文件不重复实现。
 * 新手阅读建议：先看根节点校验，再进入 AppWebEntry 阅读完整启动过程。
 */
import { AppWebEntry } from '@deepseek-ai/dsh-client-web'

/** 页面挂载元素；必须是 id 为 root 的 HTMLElement，缺失时为 null 并立即报错。 */
const el = document.getElementById('root')
if (el === null) throw new Error('web app: missing #root')
/** 创建并运行 Web 入口；返回的 Promise 在此由应用顶层有意忽略。 */
void new AppWebEntry(el).run()
