/** 两种界面共用交付事实、Host 能力及显式打开请求，避免重复提交本机操作。 */
import type { PresentedOpenController } from '../present-open.ts'
import { selectDeliverables, type DeliverablesInjected } from '../Deliverables.tsx'
import { presentedFileUrl } from '../../presented.ts'

/** 替代呈现只读取官方选择器和共享请求状态。 */
export interface DeliverablesPresentation {
  readonly select: typeof selectDeliverables
  readonly key: typeof presentedFileUrl
  readonly injected: DeliverablesInjected
}
/**
 * 将原插件持有的打开控制器绑定为稳定呈现能力。
 * @param opener - 官方插件创建和释放的唯一控制器。
 * @returns 不复制投影或请求状态的共享能力。
 */
export function createDeliverablesPresentation(opener: PresentedOpenController): DeliverablesPresentation {
  return {
    select: selectDeliverables, key: presentedFileUrl,
    injected: {
      hooks: { presentedOpen: opener.state, presentedHost: opener.host },
      reloadPresentedHost: () => opener.loadHost(),
      openPresented: (sessionId, seq, index, action) => opener.open(sessionId, seq, index, action),
    },
  }
}
