# Host 扩展、协议与持久化

## 摘要

UI 重写应保留 Host 的业务权威。若未来确需扩展后端，影响可能穿过工具、日志、Typert、两套 SDK、快照和发行数据，不能只修改一条 HTTP 调用或一个展示类型。

## 目录

- 能力与 Agent loop
- Remote 与 wire
- 日志与版本
- 系统能力和安全边界
- 改动影响矩阵

## 能力与 Agent loop

默认 loop 驱动 turn、step、模型请求和工具执行。新的模型提供者注册 LLM adapter；工具注册到工具服务；策略监听相应 agent/tools/fs 等事件。不要将奇术按钮状态写入 loop，也不要复制官方循环来控制会话。

turn 可含零或多个 step，running 区间也不等于某一条用户消息的完成。followup 无逐消息 completion 承诺；whenIdle/status 不是单条消息的返回值。自动化需要明确自己的收据和结束区间，不从一段运行状态猜因果。

模型请求应可由日志重建。新增模型可见上下文时使用已有 agent/context/event 扩展，并核对是否需要新 SessionEventMap 成员。工具的模型 schema、Host 纯 presenter 和 Client 卡片各有职责；纯布局字段不混入模型协议。

## Remote 与 wire

Host 方法经 @Remote/@RemoteScope 进入生成契约；未标记方法不自动成为浏览器 API。生成器从 Host ts.Program 构建 descriptor、schema 与 Client 声明，api-remotes 明确选择并装配公开方法。

复杂 Host 对象不能直接跨 wire，需类型 lookup 与运行期解析 provider。跨界身份用已有品牌类型；请求发起端生成 rpcId，响应端回显，业务 UI 不自造一套相关 id 协议。

直接调用 Remote namespace 的插件声明实际 `remote` 与 `remote.<namespace>` 服务依赖。只引用上层会话服务的组件不应把 Gateway/Connection 实现导入自己的运行包。

协作取消、业务失败、传输失败和协议校验失败要按真实公开类型处理。不能把所有 RemoteResult 自动 throw，也不能把所有 rejected promise 都当成 Host 未执行。新接口必须覆盖直接调用路径，不能依赖 UI 禁用来保证权限或前置条件。

## 日志与版本

| 事项 | 开发规则 |
|---|---|
| 模型历史 | deriveMessages 从 Session 日志投影；新模型可见输入必须可回放 |
| Assistant 实时输出 | process-local stream 支持即时 UI；完整 compact stream 在 settlement 持久化 |
| 失败/取消尝试 | assistant/attempt 等结构承担已落定尝试记录；硬进程丢失前未落定内容不可假装已持久化 |
| 新事件类型 | 声明合并、生产者/消费者/回放同步；未知 required-on-read 类型会拒读 |
| 可忽略事件 | 需协议 envelope 的明确 ignorable 语义，不是 UI 不认识就随便跳过 |
| 结构版本 | SESSION_FORMAT_VERSION 是 writer 权威，发布状态看专门记录；不要根据 npm version 猜格式 |
| 已发布代际 | 不覆盖、移动或删除旧 generation；相邻迁移可产生后继，不承诺降级 |
| SQLite | SCHEMA_VERSION 单调推进，不能靠重建用户数据库逃避迁移 |
| UI 本地偏好 | 不属于模型历史；与 durable Session 数据分开 |

会话格式发布义务包含 alpha/beta/RC。不要因仓库仍 pre-stable 就将用户数据当临时 fixture。快照刷新也不能改写已提交的历史代际来掩盖格式变化。

## 系统能力和安全边界

文件系统、shell、subprocess、terminal、LSP 的 provider 应处在一致执行环境。切换远端 sandbox 时复用能力接口，而不是某个工具暗中退回本地 spawn。权限决策应在真正执行操作的位置强制执行。

生命周期结束要等待静止状态；kill/abort 后立即 return 可能遗留进程或回调。临时路径采用私有目录、随机名和排他创建；不向不可信命令传递含 key/token 的环境。Windows junction/symlink 与普通目录区别处理，删除链接不能递归进入目标。

认证、授权、凭据属于相关服务和连接安全协议。qs 静态登录只演示页面跳转，不得改变 Host 身份或绕过授权；当前仓库已有相关能力，也不能因为本阶段不接登录就删除它们。

## 改动影响矩阵

| 改动 | 至少追踪到 |
|---|---|
| 新 UI 表现 | locale、槽、store、组件测试、真实浏览器输出 |
| 新 Remote 方法 | Host 类型、生成契约、api-remotes 装配、错误/取消、Client 消费者 |
| 新工具 | 定义/provider/consumer、schema、权限、模型快照、Host/Web presenter |
| loop/Session lifecycle | 架构文档、日志、重放、TypeScript SDK 和 Python SDK 输出 |
| Session 格式 | 版本 authority、codec、相邻迁移、历史 fixtures、persistence、导出/查询 |
| provider 或 subprocess | 真实 API/平台路径、环境权限、资源清理、并发测试 |
| 发布资源/依赖 | lib 产物、files、publint、NodeNext、notice、发行家族 |

## 源码依据

- [架构与 loop](../../../docs/architecture.md)
- [Agent 接口](../../../packages/core/agent/src/types.ts)
- [工具定义](../../../packages/core/tools/src/types.ts)
- [API Gateway](../../../docs/api-gateway.md)
- [Session 类型](../../../packages/core/session/src/types.ts)
- [Session 格式权威](../../../docs/session-format-status.md)
- [防御模式](../../../docs/defensive-patterns.md)
- [测试与 SDK 影响](../../../docs/testing.md)

## 开发备注

本轮对后端和 SDK 进行了架构及改动影响梳理，没有宣称已审完所有 provider/native 实现。涉及具体包时继续读取该包 README、AGENTS、代码和测试。
