/*
 * ================================ 文件注释 ================================
 * 【文件职责】shell（bash）设置卡片的控制器：把 bash 命名空间作用域桥接到
 *             卡片共享的暂存表单上。
 * 【技术维度】CardForm 复用 + SnapshotStore 投影：字段为 timeoutMs 与
 *             maxOutputBytes（数字字段）；命名空间名拼写在此。
 * 【产品维度】设置页"插件"中的 shell 卡片：命令超时与输出上限配置。
 * 【逻辑维度】构造建表单与投影存储 → projection 装配 shell + 字段 → inject
 *             暴露快照与表单动作。
 * 【关键边界】编辑字段是有意挑选的服务模式子集（不是全量）。
 * 【新手阅读建议】先读 card-form.ts，再看本控制器的薄桥接。
 * ==========================================================================
 */
/** The shell card's staged form over the `bash` settings namespace. */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import { CardForm, numberField, type CardActions, type CardFieldState, type CardShell } from './card-form.ts'

/**
 * Namespace of the shell capability. Spelled here rather than imported: a
 * client package must not depend on a Host package, and the executor families
 * that own it spell the same value.
 */
export const SHELL_NS = 'shell'

/** The shell fields this card edits — a subset of the served schema by design. */
export interface BashSettings {
  /** Foreground command timeout in milliseconds. */
  timeoutMs?: number
  /** Per-stream in-memory output cap in bytes. */
  maxOutputBytes?: number
}

/** What the shell card renders. */
export interface BashCardState extends CardShell {
  /** Command timeout in milliseconds. */
  timeoutMs: CardFieldState
  /** Per-stream output cap in bytes. */
  maxOutputBytes: CardFieldState
}

/** The registration-side face the shell card's slot entry injects. */
export interface BashCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useBashCard. */
    bashCard: SnapshotStore<BashCardState>
  }
}

/** Bridges the `bash` scope onto the shell card's staged form. */
export class BashCardController {
  private readonly form: CardForm<BashSettings>
  private readonly store: SnapshotStore<BashCardState>

  /** @param scope - the bound settings scope for the `bash` namespace. */
  constructor(scope: SettingsScope<BashSettings>) {
    this.form = new CardForm(scope, [numberField('timeoutMs'), numberField('maxOutputBytes')])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): BashCardState {
    return {
      ...this.form.shell(),
      timeoutMs: this.form.field('timeoutMs'),
      maxOutputBytes: this.form.field('maxOutputBytes'),
    }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): BashCardFace {
    return { hooks: { bashCard: this.store }, ...this.form.actions() }
  }
}
