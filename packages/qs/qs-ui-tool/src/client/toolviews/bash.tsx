/** bash / pwsh 视图：命令、输出与退出状态。 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ReactNode } from 'react'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-chat/client'
import { TerminalBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import type { QsToolviewProps } from '../contract.ts'
import { terminalLabels } from '../primitive-labels.ts'
import { callHead, hasSpill, isSettled, parseArgs, parseExitStatus, singleText, stringArg } from '../raw-tool-call.ts'
import { registerToolview, type ToolviewComponent } from '../toolview-registration.ts'
import { GenericToolCard } from './generic.tsx'
import styles from '../tool.module.css'

/** 命令类调用的视图模型。 */
export interface ShellCardModel {
  /** 命令行原文。 */
  readonly command: string
  /** 去掉尾部退出标记后的输出正文。 */
  readonly output: string
  /** 调用是否仍在运行。 */
  readonly running: boolean
  /** 退出码；文本未报告退出状态时为 undefined。 */
  readonly exitCode: number | undefined
  /** 终止信号。 */
  readonly signal: string | undefined
  /** 输出已转存：退出标记被转存提示掩盖，不能从文本推断状态。 */
  readonly spilled: boolean
  /** 文本尾部没有退出标记：不得据此声称成功。 */
  readonly exitUnreported: boolean
}

/**
 * 构建命令类调用模型。
 *
 * 参数不符契约（缺 `command`、参数不是 JSON 对象）、结果是多块内容或没有调用头时返回
 * `undefined`，由调用方回落到兜底卡；退出状态只认官方渲染器写在文本尾部的标记：
 * 干净退出不写标记，失败追加 `[exit code: N]`，信号终止追加 `[killed by signal: S]`。
 * @param block - 运行头或结算结果。
 * @returns 视图模型；无法按契约呈现时为 undefined。
 */
export function shellCardModel(block: ToolCallBlock): ShellCardModel | undefined {
  const head = callHead(block)
  if (head === undefined) return undefined
  const command = stringArg(parseArgs(head.argsRaw), 'command')
  if (command === undefined) return undefined
  if (!isSettled(block)) {
    return {
      command, output: '', running: true, exitCode: undefined, signal: undefined, spilled: false, exitUnreported: false,
    }
  }
  const text = singleText(block)
  if (text === undefined) return undefined
  if (hasSpill(text)) {
    return {
      command, output: text, running: false, exitCode: undefined, signal: undefined, spilled: true, exitUnreported: false,
    }
  }
  const status = parseExitStatus(text)
  return {
    command,
    output: status.body,
    running: false,
    exitCode: status.reported ? status.exitCode : undefined,
    signal: status.signal,
    spilled: false,
    exitUnreported: !status.reported,
  }
}

/** bash / pwsh 视图组件：模型不成立时回落兜底卡，不静默消失。 */
export const ShellToolview: ToolviewComponent = ({ block, cwd, t }: QsToolviewProps): ReactNode => {
  const model = shellCardModel(block)
  if (model === undefined) return <GenericToolCard block={block} t={t} />
  return (
    <div data-qs-tool-shell>
      <TerminalBlock
        command={model.command}
        cwd={cwd}
        output={model.output === '' ? undefined : model.output}
        exitCode={model.exitCode}
        signal={model.signal}
        running={model.running}
        labels={terminalLabels(t)}
      />
      {model.spilled ? <p className={styles.notice} data-qs-tool-shell-spilled>{t('bash.spilled')}</p> : null}
      {model.exitUnreported ? <p className={styles.notice} data-qs-tool-shell-no-exit>{t('bash.noExit')}</p> : null}
    </div>
  )
}

/**
 * 命令类视图插件：与官方 shell 子插件同职责，一个插件覆盖 bash 与 pwsh 两个分派键
 * （官方该子插件同样以一份呈现对应两种 shell 的标题映射）。
 */
export const shellToolview = {
  name: 'qs-shell-toolview',
  inject: ['slots'],
  /** 注册 bash 与 pwsh 键。 */
  apply(ctx: ClientContext): void {
    registerToolview(ctx, 'bash', ShellToolview)
    registerToolview(ctx, 'pwsh', ShellToolview)
  },
}
