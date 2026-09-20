/**
 * 答案构造。
 *
 * 协议：`{ answers: [{ id, selected: string[], custom?: string }] }`
 * （`interaction/user-questions/src/types.ts:50-64`）。**多选可以与自由文本并存**，
 * 因此 `selected` 与 `custom` 同时存在是合法状态，不互相清空。
 *
 * 单选时选项与自由文本互斥，最后一次输入决定提交内容。
 */
import type { AskUserQuestionAnswer, AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions'

/** 一题的表单草稿。 */
export interface QuestionDraft {
  /** 已选中的选项标签。 */
  readonly selected: readonly string[]
  /** 自由文本回答。 */
  readonly custom: string
}

/** 空草稿。 */
export const EMPTY_DRAFT: QuestionDraft = { selected: [], custom: '' }

/**
 * 切换一个选项的选中状态。
 *
 * 多选时切换该选项并保留自由文本；单选时选中它并清空自由文本。
 * @param question - 题目定义。
 * @param draft - 当前草稿。
 * @param label - 被点击的选项标签。
 * @returns 新草稿。
 */
export function toggleOption(
  question: AskUserQuestionItem,
  draft: QuestionDraft,
  label: string,
): QuestionDraft {
  if (question.multiSelect === true) {
    const selected = draft.selected.includes(label)
      ? draft.selected.filter(item => item !== label)
      : [...draft.selected, label]
    return { ...draft, selected }
  }
  return { selected: [label], custom: '' }
}

/**
 * 写入自由文本。
 * @param question - 题目定义。
 * @param draft - 当前草稿。
 * @param text - 用户输入。
 * @returns 新草稿。
 */
export function writeCustom(
  question: AskUserQuestionItem,
  draft: QuestionDraft,
  text: string,
): QuestionDraft {
  // 单选且已经选了某个选项时，自由文本取代选项（原型的"其他"语义）。
  if (question.multiSelect !== true && text !== '' && draft.selected.length > 0) {
    return { selected: [], custom: text }
  }
  return { ...draft, custom: text }
}

/**
 * 判断一题是否已作答。
 * @param draft - 该题草稿。
 * @returns 有选中项或非空自由文本时为 true。
 */
export function isAnswered(draft: QuestionDraft): boolean {
  return draft.selected.length > 0 || draft.custom.trim() !== ''
}

/**
 * 构造整批答案。
 * @param questions - 请求里的题目列表。
 * @param drafts - 按题目 id 的草稿。
 * @returns 答案协议对象。
 * @throws {Error} 当仍有未作答的题目。
 */
export function buildAnswer(
  questions: readonly AskUserQuestionItem[],
  drafts: ReadonlyMap<string, QuestionDraft>,
): AskUserQuestionAnswer {
  const answers = questions.map((question) => {
    const draft = drafts.get(question.id) ?? EMPTY_DRAFT
    if (!isAnswered(draft)) throw new Error(`qs-questions: question "${question.id}" is unanswered`)
    const custom = draft.custom.trim()
    return {
      id: question.id,
      selected: [...draft.selected],
      ...(custom === '' ? {} : { custom }),
    }
  })
  return { answers }
}
