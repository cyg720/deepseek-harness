/** Deterministic keyless Agent Teams adapter shared by profile snapshot and CLI e2e.
 * @remarks 文件说明：文件职责：验证 apps/cli 中 team llm 相关行为与失败场景。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import { ToolCallId, LlmAdapter } from '@deepseek-ai/dsh-llm'

/**
 * 变量说明：nextCall 用于处理 nextCall 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
 */
let nextCall = 0

/**
 * 功能说明：处理 calls 相关流程；使用场景由所在模块及调用位置决定。
 * @param messages （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 calls(messages)，并按返回类型处理结果。
 */
function calls(messages) {
  return messages.flatMap(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：message（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(message)，并按返回类型处理结果。
 */ message => message.role === 'assistant'
    ? message.content.filter(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：block（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(block)，并按返回类型处理结果。
 */ block => block.type === 'tool-call').map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：block（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(block)，并按返回类型处理结果。
 */ block => block.name)
    : [])
}

/**
 * 功能说明：处理 latestAssistantCalls 相关流程；使用场景由所在模块及调用位置决定。
 * @param messages （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 latestAssistantCalls(messages)，并按返回类型处理结果。
 */
function latestAssistantCalls(messages) {
  /**
   * 常量说明：assistant 用于处理 assistant 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const assistant = messages.findLast(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：message（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(message)，并按返回类型处理结果。
 */ message => message.role === 'assistant')
  return assistant?.content.filter(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：block（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(block)，并按返回类型处理结果。
 */ block => block.type === 'tool-call').map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：block（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(block)，并按返回类型处理结果。
 */ block => block.name) ?? []
}

/**
 * 功能说明：判断是否包含 Task Action 相关流程；使用场景由所在模块及调用位置决定。
 * @param messages （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param action （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 hasTaskAction(messages, action)，并按返回类型处理结果。
 */
function hasTaskAction(messages, action) {
  return messages.some(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：message（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(message)，并按返回类型处理结果。
 */ message => message.role === 'assistant'
    && message.content.some(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：block（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(block)，并按返回类型处理结果。
 */ (block) => {
      if (block.type !== 'tool-call' || block.name !== 'team_task_update') return false
      try {
        return JSON.parse(block.arguments).action === action
      } catch {
        return false
      }
    }))
}

/**
 * 功能说明：处理 latestToolText 相关流程；使用场景由所在模块及调用位置决定。
 * @param messages （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 latestToolText(messages)，并按返回类型处理结果。
 */
function latestToolText(messages) {
  /**
   * 常量说明：message 用于处理 message 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const message = messages.findLast(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：candidate（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(candidate)，并按返回类型处理结果。
 */ candidate => candidate.content.some(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：block（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(block)，并按返回类型处理结果。
 */ block => block.type === 'tool-result'))
  if (message === undefined) return ''
  return message.content.flatMap(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：block（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(block)，并按返回类型处理结果。
 */ block => block.type === 'tool-result'
    ? block.content.filter(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
 */ item => item.type === 'text').map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
 */ item => item.text)
    : []).join('\n')
}

/**
 * 功能说明：处理 toolChunks 相关流程；使用场景由所在模块及调用位置决定。
 * @param specs （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 toolChunks(specs)，并按返回类型处理结果。
 */
function toolChunks(specs) {
  /**
   * 常量说明：chunks 用于处理 chunks 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const chunks = []
  for (const /* 变量说明：index、spec 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。 */ [index, spec] of specs.entries()) {
    /**
     * 常量说明：id 用于处理 id 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const id = ToolCallId(`team-fixture-${++nextCall}`)
    /**
     * 常量说明：args 用于处理 args 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const args = JSON.stringify(spec.args)
    chunks.push(
      { type: 'block-start', index, blockType: 'tool-call' },
      { type: 'tool-call-delta', index, id, name: spec.name, argumentsDelta: args },
      { type: 'block-end', index, block: { type: 'tool-call', id, name: spec.name, arguments: args } },
    )
  }
  chunks.push(
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  )
  return chunks
}

/**
 * 功能说明：处理 textChunks 相关流程；使用场景由所在模块及调用位置决定。
 * @param text （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 textChunks(text)，并按返回类型处理结果。
 */
function textChunks(text) {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 3 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/**
 * 功能说明：处理 researcher 相关流程；使用场景由所在模块及调用位置决定。
 * @param messages （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 researcher(messages)，并按返回类型处理结果。
 */
function researcher(messages) {
  /**
   * 常量说明：names 用于处理 names 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const names = calls(messages)
  if (!names.includes('team_task_create')) {
    return toolChunks([{ name: 'team_task_create', args: {
      subject: 'Research', description: 'Collect the deterministic finding.', write_scopes: ['research'],
    } }])
  }
  if (!names.includes('team_task_update')) {
    return toolChunks([{ name: 'team_task_update', args: {
      task_id: 'task-1', expected_revision: 1, action: 'claim',
    } }])
  }
  if (!names.includes('send_message')) {
    return toolChunks([
      { name: 'team_task_update', args: { task_id: 'task-1', expected_revision: 2, action: 'complete' } },
      { name: 'send_message', args: { target: 'implementer', message: 'Research complete: use the deterministic finding.' } },
    ])
  }
  return textChunks('Research teammate complete.')
}

/**
 * 功能说明：处理 implementer 相关流程；使用场景由所在模块及调用位置决定。
 * @param messages （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 implementer(messages)，并按返回类型处理结果。
 */
function implementer(messages) {
  /**
   * 常量说明：names 用于处理 names 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const names = calls(messages)
  /**
   * 常量说明：last 用于处理 last 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const last = latestAssistantCalls(messages)
  /**
   * 常量说明：text 用于处理 text 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const text = latestToolText(messages)
  const userText = messages.flatMap(message => message.role === 'user'
    ? message.content.filter(block => block.type === 'text').map(block => block.text)
    : []).join('\n')
  if (!names.includes('team_task_create')) {
    if (last.includes('team_task_get') && text.includes('"subject":"Research"')) {
      return toolChunks([{ name: 'team_task_create', args: {
        subject: 'Implementation',
        description: 'Apply the deterministic finding.',
        blocked_by: ['task-1'],
        write_scopes: ['implementation'],
      } }])
    }
    if (last.includes('wait_agent')) {
      return toolChunks([{ name: 'team_task_get', args: { task_id: 'task-1' } }])
    }
    return toolChunks([{ name: 'wait_agent', args: { timeout_ms: 10000 } }])
  }
  if (!hasTaskAction(messages, 'claim')) {
    if (last.includes('team_task_get') && text.includes('"status":"completed"')) {
      return toolChunks([{ name: 'team_task_update', args: {
        task_id: 'task-2', expected_revision: 1, action: 'claim',
      } }])
    }
    if (last.includes('team_task_get')) {
      return toolChunks([{ name: 'team_task_get', args: { task_id: 'task-1' } }])
    }
    if (last.includes('wait_agent')) {
      return toolChunks([{ name: 'team_task_get', args: { task_id: 'task-1' } }])
    }
    return toolChunks([{ name: 'team_task_get', args: { task_id: 'task-1' } }])
  }
  if (!userText.includes('Research complete: use the deterministic finding.')) {
    return toolChunks([{ name: 'wait_agent', args: { timeout_ms: 10000 } }])
  }
  if (!names.includes('send_message')) {
    return toolChunks([
      { name: 'team_task_update', args: { task_id: 'task-2', expected_revision: 2, action: 'complete' } },
      { name: 'send_message', args: { target: 'lead', message: 'Implementation complete and verified.' } },
    ])
  }
  return textChunks('Implementation teammate complete.')
}

/**
 * 功能说明：处理 lead 相关流程；使用场景由所在模块及调用位置决定。
 * @param messages （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 lead(messages)，并按返回类型处理结果。
 */
function lead(messages) {
  /**
   * 常量说明：names 用于处理 names 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const names = calls(messages)
  /**
   * 常量说明：last 用于处理 last 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const last = latestAssistantCalls(messages)
  /**
   * 常量说明：spawned 用于处理 spawned 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const spawned = names.filter(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：name（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(name)，并按返回类型处理结果。
 */ name => name === 'spawn_teammate').length
  if (spawned === 0) {
    return toolChunks([{
      name: 'spawn_teammate',
      args: {
        name: 'implementer',
        description: 'Own deterministic implementation.',
        prompt: 'IMPLEMENTER_MARK: wait for research, complete dependent task 2, report to lead.',
        context: 'fresh',
      },
    }])
  }
  if (spawned === 1) {
    return toolChunks([{
      name: 'spawn_teammate',
      args: {
        name: 'researcher',
        description: 'Own deterministic research.',
        prompt: 'RESEARCHER_MARK: complete research task 1, message implementer, then finish.',
        context: 'fresh',
      },
    }])
  }
  /**
   * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const result = latestToolText(messages)
  if (last.includes('team_task_list')) {
    /**
     * 常量说明：completed 用于处理 completed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const completed = result.match(/"status":"completed"/gu)?.length ?? 0
    if (completed >= 2) return toolChunks([{ name: 'list_agents', args: {} }])
    return toolChunks([{ name: 'team_task_list', args: {} }])
  }
  if (last.includes('list_agents')) {
    /**
     * 常量说明：inactive 用于处理 inactive 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const inactive = result.match(/"status":"inactive"/gu)?.length ?? 0
    if (inactive >= 2) return textChunks('TEAM_WORKFLOW_OK: both teammates and dependent tasks completed.')
    return toolChunks([{ name: 'list_agents', args: {} }])
  }
  if (last.includes('wait_agent')) return toolChunks([{ name: 'team_task_list', args: {} }])
  return toolChunks([{ name: 'wait_agent', args: { timeout_ms: 10000 } }])
}

/**
 * 类说明：TeamFixtureAdapter 用于集中封装 处理 TeamFixtureAdapter 相关状态与行为。
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。
 * 使用场景：由 apps/cli 在对应插件或业务生命周期内创建和调用。
 */
class TeamFixtureAdapter extends LlmAdapter {
  /**
   * 功能说明：处理 stream 相关流程；使用场景由所在模块及调用位置决定。
   * @param options （由 TypeScript 根据调用位置推断的类型）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 stream(options)，并按返回类型处理结果。
   */
  async * stream(options) {
    /**
     * 常量说明：userText 用于处理 userText 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const userText = options.messages.flatMap(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：message（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(message)，并按返回类型处理结果。
 */ message => message.role === 'user'
      ? message.content.filter(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：block（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(block)，并按返回类型处理结果。
 */ block => block.type === 'text').map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：block（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(block)，并按返回类型处理结果。
 */ block => block.text)
      : []).join('\n')
    /**
     * 常量说明：chunks 用于处理 chunks 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const chunks = userText.includes('RESEARCHER_MARK')
      ? researcher(options.messages)
      : userText.includes('IMPLEMENTER_MARK')
        ? implementer(options.messages)
        : lead(options.messages)
    for (const /* 变量说明：chunk 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。 */ chunk of chunks) {
      options.signal?.throwIfAborted()
      yield chunk
    }
  }
}

/** Cordis plugin name.
 * @remarks 中文说明：常量说明：name 用于处理 name 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const name = 'team-fixture-llm'
/** LLM registry dependency.
 * @remarks 中文说明：常量说明：inject 用于处理 inject 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const inject = ['llm']

/** Register the keyless adapter on the shipped default provider route.
 * @remarks 中文说明：功能说明：注册并应用 apply 相关流程；使用场景由所在模块及调用位置决定。；参数说明：ctx（由
 * TypeScript 根据调用位置推断的类型）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；返回值：由
 * TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * apply(ctx)，并按返回类型处理结果。 */
export function apply(ctx) {
  ctx.llm.registerAdapter(['deepseek-official'], new TeamFixtureAdapter())
}
