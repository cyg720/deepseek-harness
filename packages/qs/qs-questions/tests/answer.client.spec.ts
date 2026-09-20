import { describe, expect, it } from 'vitest'
import type { AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions'
import {
  buildAnswer, EMPTY_DRAFT, isAnswered, toggleOption, writeCustom,
} from '../src/client/answer.ts'
import { planReviewOf } from '../src/client/plan-review.ts'

const single: AskUserQuestionItem = {
  id: 'q1',
  question: '选哪个车间？',
  options: [{ label: '一车间' }, { label: '二车间' }],
}

const multi: AskUserQuestionItem = {
  id: 'q2',
  question: '关注哪些指标？',
  multiSelect: true,
  options: [{ label: '温度' }, { label: '压力' }],
}

describe('答案协议构造', () => {
  it('单选替换选中项', () => {
    const first = toggleOption(single, EMPTY_DRAFT, '一车间')
    expect(first.selected).toEqual(['一车间'])
    expect(toggleOption(single, first, '二车间').selected).toEqual(['二车间'])
  })

  it('多选可累加，也可取消', () => {
    const first = toggleOption(multi, EMPTY_DRAFT, '温度')
    const second = toggleOption(multi, first, '压力')
    expect(second.selected).toEqual(['温度', '压力'])
    expect(toggleOption(multi, second, '温度').selected).toEqual(['压力'])
  })

  it('多选下自由文本与选中项并存', () => {
    const draft = writeCustom(multi, toggleOption(multi, EMPTY_DRAFT, '温度'), '还有振动')
    expect(draft.selected).toEqual(['温度'])
    expect(draft.custom).toBe('还有振动')
    const answer = buildAnswer([multi], new Map([['q2', draft]]))
    expect(answer.answers[0]).toEqual({ id: 'q2', selected: ['温度'], custom: '还有振动' })
  })

  it('多选输入自由文本后选择选项仍保留二者', () => {
    const draft = toggleOption(multi, writeCustom(multi, EMPTY_DRAFT, '还有振动'), '温度')
    expect(buildAnswer([multi], new Map([['q2', draft]]))).toEqual({ answers: [{ id: 'q2', selected: ['温度'], custom: '还有振动' }] })
  })

  it('单选下自由文本取代选项（原型"其他"语义）', () => {
    const draft = writeCustom(single, toggleOption(single, EMPTY_DRAFT, '一车间'), '都不对')
    expect(draft.selected).toEqual([])
    expect(buildAnswer([single], new Map([['q1', draft]])).answers[0])
      .toEqual({ id: 'q1', selected: [], custom: '都不对' })
  })

  it('未作答的题阻止整批提交', () => {
    expect(isAnswered(EMPTY_DRAFT)).toBe(false)
    expect(() => buildAnswer([single], new Map())).toThrow(/unanswered/)
  })

  it('多问题批次按顺序整体提交', () => {
    const drafts = new Map([
      ['q1', toggleOption(single, EMPTY_DRAFT, '二车间')],
      ['q2', toggleOption(multi, EMPTY_DRAFT, '压力')],
    ])
    expect(buildAnswer([single, multi], drafts).answers.map(a => a.id)).toEqual(['q1', 'q2'])
  })
})

describe('plan-review 判定', () => {
  const review: AskUserQuestionItem = {
    id: 'plan',
    question: '确认执行计划？',
    detail: '## 步骤\n1. 停机检查',
    intent: { kind: 'plan-review', approve: '批准' },
    options: [{ label: '批准' }, { label: '不批准' }],
  }

  it('命中单问题 + detail + 非多选 + approve 按名匹配', () => {
    const result = planReviewOf([review])
    expect(result?.approve.label).toBe('批准')
    expect(result?.decline?.label).toBe('不批准')
  })

  it('只有批准选项时 decline 缺省（合法请求）', () => {
    const only = { ...review, options: [{ label: '批准' }] }
    expect(planReviewOf([only])?.decline).toBeUndefined()
  })

  it('不按位置推断：approve 名字对不上就不接管', () => {
    expect(planReviewOf([{ ...review, options: [{ label: '继续' }, { label: '停止' }] }])).toBeUndefined()
  })

  it('多问题批次、多选、选项超过两个、缺 detail 都交给通用流程', () => {
    expect(planReviewOf([review, review])).toBeUndefined()
    expect(planReviewOf([{ ...review, multiSelect: true }])).toBeUndefined()
    expect(planReviewOf([{ ...review, options: [{ label: '批准' }, { label: '不批准' }, { label: '稍后' }] }]))
      .toBeUndefined()
    const { detail: _dropped, ...withoutDetail } = review
    expect(planReviewOf([withoutDetail])).toBeUndefined()
  })
})
