/**
 * ================================ 文件注释 ================================
 * 【文件职责】为 shell 工具族（tool-bash、tool-pwsh）提供共享的渲染/解析辅助：
 * 定义"退出状态标记"的文本契约——渲染端写入、展示层读回，是本包对外导出的纯函数模块。
 * 【技术维度】纯文本正则解析，无运行时依赖；在"模型可见的渲染结果字符串"与结构化退出状态
 * （退出码或信号）之间双向转换，是工具渲染器与终端展示层之间的事实交换格式。
 * 【产品维度】模型执行完 shell 命令后，聊天界面要把退出码单独画成一个徽章而不是混在输出里；
 * 本模块负责从纯文本里把这一信息重新剥离出来，供展示层绘制。
 * 【逻辑维度】先匹配 `[killed by signal: X]`（带信号名），再匹配 `[exit code: N]`（带数字），
 * 都不命中则视为干净退出（exitCode 0）；命中时把标记从正文中切除。
 * 【关键边界】只认"以换行开头且位于字符串末尾"的标记，避免普通输出结尾恰好长得像标记被误拆；
 * 超时、沙箱拒绝等其他标记不会在此移除，因为界面上没有对应徽章。
 * 【新手阅读建议】先看 ParsedExitStatus 理解返回结构，再看 parseExitStatus 的两条正则；
 * 可对照 tool-bash/render 与 tool-pwsh/render 里生成这些标记的代码反向印证。
 * ==========================================================================
 */

/**
 * Shared rendering helpers for the shell tools (`dsh-tool-bash`,
 * `dsh-tool-pwsh`): the exit-status marker contract the tools' renderers
 * emit and the presentation layer parses back.
 * @module @deepseek-ai/dsh-shell/render
 */

/**
 * The exit status recovered from a rendered result, with the output body that
 * status was split off from.
 */
/**
 * 退出状态解析结果：body 是剥离掉退出标记后的纯输出正文；exitCode 表示以退出码结束，
 * signal 表示被信号杀死。二者通过联合类型互斥，一次解析只会落到其中一种情况。
 */
export type ParsedExitStatus =
  & { body: string }
  & ({ exitCode: number } | { signal: string })

/**
 * Split a rendered shell-tool result string into its output body and the
 * structured exit status — the inverse of the `[exit code: N]` /
 * `[killed by signal: X]` markers the shell tools' renderers append. A killed
 * marker yields `signal`; otherwise a non-zero marker yields `exitCode`;
 * absent both means a clean exit 0.
 *
 * The consumed marker is removed from `body` because a terminal presentation
 * shows the exit status as its own pill: leaving the marker in the output
 * would render the exit twice. Other markers (timeout, sandbox denial) carry
 * facts no pill shows, so they stay in the body.
 *
 * Replay only retains the rendered content text, not the original
 * `ShellRunResult`, so terminal presentation must recover the exit pill here.
 * Requiring a leading newline and the end of the string keeps ordinary output
 * that merely ends with marker-like text from matching unless the final line
 * is indistinguishable from a real marker.
 * @param text - rendered model-facing shell-tool result.
 * @returns the marker-free body plus the recovered terminal exit code or signal.
 */
/**
 * 把渲染好的 shell 工具结果字符串拆成"输出正文 + 结构化退出状态"，是渲染端
 * `[exit code: N]` / `[killed by signal: X]` 标记的逆操作。终端展示层会把退出状态画成独立
 * 小徽章，因此匹配到的标记必须从正文中切除，否则退出信息会显示两遍；超时、沙箱拒绝等
 * 没有对应徽章的标记则原样留在正文里。要求标记以换行开头并位于字符串末尾，是为了防止
 * 普通输出恰好以相似文本结尾时被误拆。快照回放只保留渲染文本而非原始 ShellRunResult，
 * 所以终端展示必须在这里恢复退出徽章所需的信息。
 * @param text 模型看到的 shell 工具渲染结果字符串
 * @returns 不含退出标记的正文，外加恢复出的退出码或信号名
 */
export function parseExitStatus(text: string): ParsedExitStatus {
  const signal = /\n\[killed by signal: ([^\]\n]+)\]$/.exec(text)
  if (signal?.[1] !== undefined) return { body: text.slice(0, signal.index), signal: signal[1] }
  const exit = /\n\[exit code: (\d+)\]$/.exec(text)
  if (exit?.[1] !== undefined) return { body: text.slice(0, exit.index), exitCode: Number(exit[1]) }
  return { body: text, exitCode: 0 }
}
