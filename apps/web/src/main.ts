/** Browser entry for the Web client. */
import { AppWebEntry } from '@deepseek-ai/dsh-client-web'

/** 页面挂载元素；必须是 id 为 root 的 HTMLElement，缺失时为 null 并立即报错。 */
const el = document.getElementById('root')
if (el === null) throw new Error('web app: missing #root')
/** 创建并运行 Web 入口；返回的 Promise 在此由应用顶层有意忽略。 */
void new AppWebEntry(el).run()
