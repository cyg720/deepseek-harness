/**
 * 文件职责：为 Pi AI 流式测试提供进程内凭据存储和空环境认证上下文。
 * 技术维度：使用 Map、异步函数和 PiAiAuthInjection 接口实现轻量测试替身。
 * 产品维度：让模型流测试聚焦生成行为，不依赖真实凭据文件或环境变量。
 * 逻辑维度：用 seed 初始化 Map，公开读、列、改、删操作，并让环境和文件查询始终未命中。
 * 关键边界：只适合不测试真实认证来源的用例；需要真实记录时应使用 credentialStoreFrom。
 * 新手阅读建议：先看 stored，再按 read/list/modify/delete 理解存储行为，最后看 authContext。
 */
import type { Credential } from '@earendil-works/pi-ai'
import type { PiAiAuthInjection } from '../src/adapter.ts'

/**
 * The auth injectables for tests that exercise streaming rather than
 * authentication: an in-process credential store and an ambient context that
 * finds nothing. A test needing real records builds the store over
 * `ctx.credentials` instead, through `credentialStoreFrom`.
 * @param seed - credentials to start with, by pi-ai provider id.
 * @returns the injection to hand `PiAiAdapter`, with its store readable.
 */
/* 创建内存认证注入。@param seed 按提供者 id 索引的初始凭据。@returns 注入对象和可读 stored Map。@example memoryAuth({ deepseek: credential })。 */
export function memoryAuth(seed: Record<string, Credential> = {}): PiAiAuthInjection & {
  // 供测试直接检查的凭据映射。
  stored: Map<string, Credential>
} {
  // 内存凭据表；键为提供者 id，值为对应 Credential。
  const stored = new Map(Object.entries(seed))
  return {
    stored,
    credentials: {
      // id 是提供者标识；缺失时解析为 undefined。
      read: id => Promise.resolve(stored.get(id)),
      // providerId/credential 是单条映射；列表只公开提供者和凭据类型摘要。
      list: () => Promise.resolve([...stored].map(([providerId, credential]) => ({
        providerId,
        type: credential.type,
      }))),
      /** 修改凭据。@param id 提供者标识。@param mutate 根据旧值计算新值的函数。@returns 修改后的可选凭据。 */
      async modify(id, mutate) {
        // 修改函数计算的下一值；undefined 表示不覆盖现有记录。
        const next = await mutate(stored.get(id))
        if (next !== undefined) stored.set(id, next)
        return stored.get(id)
      },
      // id 是待删除提供者；删除不存在记录也视为成功。
      delete: (id) => {
        stored.delete(id)
        return Promise.resolve()
      },
    },
    authContext: {
      env: () => Promise.resolve(undefined),
      fileExists: () => Promise.resolve(false),
    },
  }
}
