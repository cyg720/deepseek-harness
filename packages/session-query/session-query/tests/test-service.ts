/**
 * 文件职责：提供仅用于测试的会话查询服务具体实现，返回后端无关的空搜索结果。
 * 技术维度：继承 SessionQueryEngine 抽象服务并覆盖会话与事件搜索方法。
 * 产品维度：让上层查询行为测试无需启动 SQLite 或其他真实搜索后端。
 * 逻辑维度：会话搜索直接返回空页；事件搜索先读取目标会话表面，再返回该会话和空项目。
 * 关键边界：只适用于测试；忽略执行上下文，不实现过滤、分页或真实命中。
 * 新手阅读建议：先对照父类抽象方法签名，再比较两个覆盖方法为何对 session 的处理不同。
 */
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import type {
  SessionEventSearchPage,
  SessionEventSearchRequest,
  SessionSearchExecContext,
  SessionSearchHit,
  SessionSearchPage,
  SessionSearchRequest,
} from '@deepseek-ai/dsh-session-query'

/** Test-only concrete query service for backend-independent behavior. */
/** TestSessionQueryEngine：用于后端无关测试的最小具体查询服务，所有命中列表为空。 */
export class TestSessionQueryEngine extends SessionQueryEngine {
  /**
   * 功能描述：返回不含任何会话命中的已完成分页结果。
   * 参数说明：_request 是未使用的查询条件；_exec 是可选且未使用的执行上下文。
   * 返回值解释：解析为 items 为空数组的 SessionSearchPage。
   * 使用示例：await engine.searchSessions(request) 得到 { items: [] }。
   */
  override searchSessions(
    _request: SessionSearchRequest,
    _exec?: SessionSearchExecContext,
  ): Promise<SessionSearchPage<SessionSearchHit>> {
    return Promise.resolve({ items: [] })
  }

  /**
   * 功能描述：读取指定会话表面，并返回该会话下不含事件命中的分页结果。
   * 参数说明：request 提供 sessionId；_exec 是可选且未使用的执行上下文。
   * 返回值解释：返回包含目标 session 和空 items 的事件搜索页。
   * 使用示例：await engine.searchEvents({ sessionId, ...filters })。
   */
  override async searchEvents(
    request: SessionEventSearchRequest,
    _exec?: SessionSearchExecContext,
  ): Promise<SessionEventSearchPage> {
    return {
      session: (await this.readSurface(request.sessionId)).session,
      items: [],
    }
  }
}
