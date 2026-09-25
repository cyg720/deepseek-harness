/** todo_write 视图：由调用参数还原的待办清单（官方不写结构化 meta）。 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ReactNode } from 'react'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { QsToolviewProps } from '../contract.ts'
import { callHead, isSettled, parseArgs } from '../raw-tool-call.ts'
import { registerToolview, type ToolviewComponent } from '../toolview-registration.ts'
import { GenericToolCard } from './generic.tsx'
import styles from '../tool.module.css'

/** 待办项状态；与官方 `todo_write` 参数枚举一致。 */
export type TodoStatus = 'pending' | 'in_progress' | 'completed'

/** 一项待办。 */
export interface TodoEntry {
  /** 任务文本。 */
  readonly content: string
  /** 生命周期状态。 */
  readonly status: TodoStatus
}

/** `todo_write` 的视图模型。 */
export interface TodoCardModel {
  /** 完整任务清单，替换语义与工具一致。 */
  readonly todos: readonly TodoEntry[]
  /** 已完成数量。 */
  readonly done: number
}

/**
 * 校验待办项。
 * @param value - 参数数组里的一项。
 * @returns 待办项；结构不符时为 undefined（被拒绝的调用会保留原始参数）。
 */
function todoEntry(value: unknown): TodoEntry | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const entry = value as { content?: unknown; status?: unknown }
  if (typeof entry.content !== 'string' || entry.content === '') return undefined
  if (entry.status !== 'pending' && entry.status !== 'in_progress' && entry.status !== 'completed') return undefined
  return { content: entry.content, status: entry.status }
}

/**
 * 构建待办模型。
 * @param block - 运行头或结算结果。
 * @returns 视图模型；执行失败或参数不符契约时为 undefined。
 */
export function todoCardModel(block: ToolCallBlock): TodoCardModel | undefined {
  // 请求清单不是写入成功的证据；失败结果由兜底卡完整呈现。
  if (isSettled(block) && block.isError) return undefined
  const head = callHead(block)
  if (head === undefined) return undefined
  const todos = parseArgs(head.argsRaw)?.todos
  if (!Array.isArray(todos) || todos.length === 0) return undefined
  const entries: TodoEntry[] = []
  for (const todo of todos) {
    const entry = todoEntry(todo)
    if (entry === undefined) return undefined
    entries.push(entry)
  }
  return { todos: entries, done: entries.filter(entry => entry.status === 'completed').length }
}

/**
 * 待办项状态文案键。
 * @param status - 待办项状态。
 * @returns 本地化键。
 */
export function todoStatusKey(status: TodoStatus): 'todo.pending' | 'todo.inProgress' | 'todo.completed' {
  if (status === 'pending') return 'todo.pending'
  if (status === 'in_progress') return 'todo.inProgress'
  return 'todo.completed'
}

/** 待办视图组件：模型不成立时回落兜底卡。 */
export const TodoToolview: ToolviewComponent = ({ block, t }: QsToolviewProps): ReactNode => {
  const model = todoCardModel(block)
  if (model === undefined) return <GenericToolCard block={block} t={t} />
  return (
    <div data-qs-tool-todo>
      <p className={styles.label}>{t('todo.summary', { done: model.done, total: model.todos.length })}</p>
      <ul className={styles.todoList}>
        {model.todos.map((todo, index) => (
          <li key={index} data-todo-status={todo.status}>
            <span className={styles.askQuestion}>{todo.content}</span>
            <span className={styles.todoStatus}> · {t(todoStatusKey(todo.status))}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** todo_write 视图插件。 */
export const todoToolview = {
  name: 'qs-todo-toolview',
  inject: ['slots'],
  /** 注册 todo_write 键。 */
  apply(ctx: ClientContext): void {
    registerToolview(ctx, 'todo_write', TodoToolview)
  },
}
