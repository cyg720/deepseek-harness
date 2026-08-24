/**
 * The agent-preset chip on the new-session screen, beside the workspace
 * picker.
 *
 * It lives here rather than in the composer because the choice is only
 * available before a conversation starts: once a turn has run, the session's
 * history was produced under that preset's tools and the host refuses to swap
 * them. A control that spends most of its life disabled belongs on the screen
 * where it still works.
 *
 * The menu opens on the staged choice, which starts as the deployment default.
 * Picking stages; the choice reaches a session when one becomes current.
 */
/**
 * 文件职责：实现预设界面的 AgentPresetSeat 组件及交互。
 * 技术维度：React、TypeScript、Cordis 插槽、响应式快照和 CSS Modules。
 * 产品维度：帮助用户查看、选择或管理会话使用的代理预设。
 * 逻辑维度：读取注入状态，派生展示数据，响应操作并渲染组件树。
 * 关键边界：运行中会话的组成不可切换；异步操作和弹层必须随状态关闭。
 * 新手阅读建议：先读 Props 与注入接口，再看派生变量、effect 和 JSX。
 */

import { useEffect, useState } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconAgentPresetOutline16, IconChevronDownOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: pulls the ui-conversation SlotMap merge (the hero seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { AgentPresetSeatState } from './seat-store.ts'
import { presetDisplayText } from './locales.ts'
import css from './AgentPresetSeat.module.css'

/** Registration-side business face for the hero chip. */
/** 中文说明：类型 AgentPresetSeatInjected 约束本文件数据字段及允许取值。 */
export interface AgentPresetSeatInjected {
  /** 中文说明：成员 hooks 保存实例运行状态，取值由声明类型限定。 */
  hooks: {
    /** Seat snapshot bound by the renderer as useAgentPresetSeat. */
    agentPresetSeat: SnapshotStore<AgentPresetSeatState>
  }
  /** Read the roster when the chip first renders. */
  /** 中文说明：成员 load 保存实例运行状态，取值由声明类型限定。 */
  load: () => Promise<void>
  /** Stage one preset for the next session. */
  /** 中文说明：成员 select 保存实例运行状态，取值由声明类型限定。 */
  select: (id: string) => Promise<void>
  /** Clear the one-shot introduce cue once the chip has played it. */
  /** 中文说明：成员 introduced 保存实例运行状态，取值由声明类型限定。 */
  introduced: () => void
}

/* Introduce timeline: the icon eases in first (the CSS animation shares this
   duration); the name's characters start fading up the moment it lands, each
   taking the fade duration to settle. The cue clears after the last one. The
   stagger is capped twice: per tick for short CJK names, and by one shared
   reveal window so a long Latin name finishes in the same time as its CJK
   counterpart instead of dragging the run out per character. */
/** 中文说明：当前处理步骤的局部值 INTRO_TEXT_DELAY_MS，取值由紧邻初始化决定，仅在当前作用域使用。 */
const INTRO_TEXT_DELAY_MS = 150
/** 中文说明：当前处理步骤的局部值 INTRO_CHAR_STAGGER_MS，取值由紧邻初始化决定，仅在当前作用域使用。 */
const INTRO_CHAR_STAGGER_MS = 40
/** 中文说明：当前处理步骤的局部值 INTRO_TEXT_REVEAL_MS，取值由紧邻初始化决定，仅在当前作用域使用。 */
const INTRO_TEXT_REVEAL_MS = 200
/** 中文说明：当前处理步骤的局部值 INTRO_CHAR_FADE_MS，取值由紧邻初始化决定，仅在当前作用域使用。 */
const INTRO_CHAR_FADE_MS = 400

/**
 * Per-character start offset for the introduce reveal.
 * @param count - character count of the shown preset name.
 * @returns milliseconds between successive character starts.
 */
/** 中文说明：函数 introStaggerMs 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function introStaggerMs(count: number): number {
  if (count <= 1) return 0
  return Math.min(INTRO_CHAR_STAGGER_MS, INTRO_TEXT_REVEAL_MS / (count - 1))
}

/** Full component props. */
/** 中文说明：类型 AgentPresetSeatProps 约束本文件数据字段及允许取值。 */
export type AgentPresetSeatProps =
  PropsRuntime<'conversation.hero.agentPreset'>
  & PropsLocale<'settings.agentPreset'>
  & InjectFace<AgentPresetSeatInjected>

/**
 * Render the new-session agent-preset chip.
 * @param props - composed slot props.
 * @returns the chip, or null when the deployment composes no presets.
 */
/** 中文说明：函数 AgentPresetSeat 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
export function AgentPresetSeat({ load, select, introduced, useAgentPresetSeat, t }: AgentPresetSeatProps) {
  /** 中文说明：当前状态或快照 state，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const state = useAgentPresetSeat(snapshot => snapshot)
  /** 中文说明：当前处理步骤的局部值 [open, setOpen]，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const [open, setOpen] = useState(false)

  useEffect(() => {
    void load()
  }, [load])

  /** 中文说明：当前处理步骤的局部值 chosen，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const chosen = state.options.find(option => option.id === state.current)
  /** 中文说明：当前处理步骤的局部值 chosenText，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const chosenText = chosen === undefined ? undefined : presetDisplayText(chosen, t)
  /** 中文说明：当前处理步骤的局部值 label，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const label = chosenText?.name ?? state.current
  /** 中文说明：当前处理步骤的局部值 ready，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const ready = state.options.length > 0 && state.current !== ''

  // The introduce cue: the pick was staged from another screen (the settings
  // creator entry), so the chip announces it — the icon eases in and each
  // character of the name fades up on a stagger (CSS owns the motion; this
  // effect only arms it and acknowledges the cue once the run is over).
  /** 中文说明：当前处理步骤的局部值 [introducing, setIntroducing]，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const [introducing, setIntroducing] = useState(false)
  useEffect(() => {
    if (!state.introduce || !ready) return
    /** 中文说明：当前处理步骤的局部值 characters，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const characters = Array.from(label)
    if (characters.length === 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      introduced()
      return
    }
    setIntroducing(true)
    /** 中文说明：当前处理步骤的局部值 done，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const done = window.setTimeout(() => {
      setIntroducing(false)
      introduced()
    }, INTRO_TEXT_DELAY_MS + (characters.length - 1) * introStaggerMs(characters.length) + INTRO_CHAR_FADE_MS)
    return () => { window.clearTimeout(done) }
  }, [state.introduce, ready, label, introduced])

  // Nothing to choose between: the deployment composes no presets and every
  // session shares the host composition.
  if (!ready) return null

  // One wrapper span: the chip is a flex row with a gap, so loose character
  // spans would each pick up the gap between them.
  /** 中文说明：当前处理步骤的局部值 characters，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const characters = Array.from(label)
  /** 中文说明：当前处理步骤的局部值 stagger，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const stagger = introStaggerMs(characters.length)
  /** 中文说明：当前处理步骤的局部值 shownLabel，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const shownLabel = introducing
    ? (
      <span className={css.introText}>
        {characters.map((character, index) => (
          <span
            key={index}
            className={css.introChar}
            style={{ animationDelay: `${INTRO_TEXT_DELAY_MS + index * stagger}ms` }}
          >
            {character}
          </span>
        ))}
      </span>
    )
    : label

  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      items={state.options.map((option) => {
        /** 中文说明：当前处理步骤的局部值 text，取值由紧邻初始化决定，仅在当前作用域使用。 */
        const text = presetDisplayText(option, t)
        return {
          id: option.id,
          // Name and description together: the id alone never says what a
          // preset does, which is why the roster carries display copy.
          label: (
            <span className={css.item}>
              <span className={css.itemName}>{text.name}</span>
              <span className={css.itemDesc}>{text.description ?? t('noDescription')}</span>
            </span>
          ),
        }
      })}
      selectedId={state.current}
      onSelect={(id) => {
        setOpen(false)
        void select(id)
      }}
      align="start"
      portal
      anchor={(
        <button
          type="button"
          className={css.seat}
          aria-haspopup="menu"
          aria-expanded={open}
          title={state.error ?? t('seatHint')}
          disabled={state.busy}
          onClick={() => { setOpen(value => !value) }}
        >
          <IconAgentPresetOutline16 className={introducing ? `${css.seatIcon} ${css.introIcon}` : css.seatIcon} />
          {shownLabel}
          <IconChevronDownOutline14 className={css.chevron} />
        </button>
      )}
    />
  )
}
