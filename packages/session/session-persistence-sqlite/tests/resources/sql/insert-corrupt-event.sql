-- 文件职责：验证 session/session-persistence-sqlite 中 insert corrupt event 相关行为与失败场景。
-- 技术维度：主要使用SQL、事务化持久化与数据库约束，通过当前文件中的类型、函数与数据结构完成实现。
-- 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
-- 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
-- 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
-- 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
-- 语句说明：INSERT 语句负责更新或查询当前持久化结构；执行时必须遵守事务、顺序和兼容性约定。
INSERT INTO events (session_id, seq, type, time, data, is_packed)
VALUES ((SELECT id FROM sessions WHERE session_key = ?), ?, ?, ?, ?, ?);
