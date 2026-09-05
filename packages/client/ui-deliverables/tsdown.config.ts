/**
 * 文件职责：声明交付物界面插件的 Node 端与浏览器端构建入口。
 * 技术维度：通过 tsdown `clientBundle` 预设打包产出文件尾栏和文件引用交互。
 * 产品维度：帮助用户在模型回复中直接发现并打开任务生成的文件。
 * 逻辑维度：导入共享预设，再传入包名与两个 Node 端入口生成默认配置。
 * 关键边界：文件识别与点击行为由业务源码实现；invariant 入口不得省略。
 * 新手阅读建议：先看双端输出，再追踪产出文件数据如何进入回复尾栏和链接。
 */
import { clientBundle } from '../tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-client-ui-deliverables', ['lib/types/index.js'])
