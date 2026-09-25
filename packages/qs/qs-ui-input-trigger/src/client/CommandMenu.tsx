/** QS 候选菜单只消费官方控制器，光标与按键由可见输入转交。 */
import { useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react'
import type { InputTriggerController } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { SessionInput } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { QsCommandOverlayOwner } from '@deepseek-ai/dsh-qs-composer/client'
import { createCommandInputBridge } from './input-bridge.ts'
import styles from './menu.module.css'

/** 一个会话的官方输入与候选控制器。 */
export interface CommandMenuInjected {
  readonly controller: InputTriggerController
  readonly input: SessionInput
}
/** 独立菜单接收的注入能力与输入宿主座席。 */
export type CommandMenuProps = CommandMenuInjected & QsCommandOverlayOwner & PropsLocale<'qs-ui-input-trigger'>

/**
 * 命令候选保持输入焦点，卸载解除适配器并关闭旧会话菜单。
 * @param props - 官方控制器、本地化与可见输入。
 * @returns 候选菜单；关闭时不呈现。
 */
export function CommandMenu({ controller, input, inputElement, frozen, composing, bindCommandInput, t }: CommandMenuProps): ReactNode {
  const state = useSyncExternalStore(listener => controller.menu.subscribe(listener), () => controller.menu.getSnapshot())
  const root = useRef<HTMLDivElement | null>(null)
  const bridge = useMemo(() => createCommandInputBridge(input, controller), [input, controller])
  useEffect(() => {
    const release = bindCommandInput(bridge)
    return () => { release(); controller.dismiss() }
  }, [bindCommandInput, bridge, controller])
  useEffect(() => {
    const track = (): void => { bridge.track(inputElement.current?.selectionEnd ?? 0, frozen || composing.current) }
    track()
    return input.state.subscribe(track)
  }, [input, bridge, inputElement, frozen, composing])
  useEffect(() => {
    if (!state.open) return
    const outside = (event: PointerEvent): void => {
      if (event.target instanceof Node && (root.current?.contains(event.target) || event.target === inputElement.current)) return
      controller.dismiss()
    }
    document.addEventListener('pointerdown', outside)
    return () => { document.removeEventListener('pointerdown', outside) }
  }, [state.open, controller, inputElement])
  useEffect(() => {
    root.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [state.highlight])
  if (!state.open) return null
  return <div className={styles.menu} ref={root} data-qs-command-menu>
    <div className={styles.heading}><strong>{t('title')}</strong>
      <button type="button" className="qs-text-button" onClick={() => { controller.dismiss() }}>{t('close')}</button>
    </div>
    <div role="listbox" aria-label={t('title')}>
      {state.groups.map(group => <div key={group.source}>
        {group.status === 'pending' ? <div role="status">{t('loading')}</div> : null}
        {group.items.map((item, index) => <button key={item.name} type="button" role="option"
          className={styles.option} aria-selected={state.highlight?.source === group.source && state.highlight.index === index}
          onMouseDown={(event) => { event.preventDefault() }}
          onMouseMove={() => { controller.hover(group.source, index) }}
          onClick={() => { controller.pick(group.source, index); inputElement.current?.focus({ preventScroll: true }) }}>
          <span>{item.label ?? item.name}</span><code>{item.name}</code>
          {item.description === undefined ? null : <small>{item.description}</small>}
        </button>)}
      </div>)}
    </div>
  </div>
}
