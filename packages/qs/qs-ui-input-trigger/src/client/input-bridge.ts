/** 文本输入同步到官方控制器，不维护候选或命令执行的副本。 */
import type { SessionInput } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InputTriggerController } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { QsCommandInputBridge } from '@deepseek-ai/dsh-qs-composer/client'

/**
 * 把当前修订号、光标和输入阶段送入同一会话控制器。
 * @param input - 官方会话输入机。
 * @param controller - 官方候选控制器。
 * @returns 输入区按键和光标适配器。
 */
export function createCommandInputBridge(input: SessionInput, controller: InputTriggerController): QsCommandInputBridge {
  return {
    track: (caret, composing) => {
      const state = input.state.getSnapshot()
      const tier = composing || state.phase === 'adjudicating' || state.phase === 'submitting'
        ? 'frozen' : state.phase === 'claimed' ? 'claimed' : 'plain'
      controller.track(state.draft, caret, { tier }, state.draftRev)
    },
    arbitrate: (key, composing) => controller.arbitrate(key, composing),
    space: () => controller.onSpace(),
  }
}
