# Web 槽位、状态与渲染

## 摘要

组件通过注册进入槽树，不能跨 feature 包导入后直接拼成另一套应用。槽声明、授权渲染、store 和 hook 都有具体 owner；遵守这些限制才能让卸载、HMR 和官方 UI 共存可靠。

## 目录

- 分层与组件输入
- 槽的类型与所有权
- 响应式数据和 store
- keyed 流式订阅
- 错误边界和切换

## 分层与组件输入

数据对象层不依赖 React；ui-renderer 负责 Context、useSyncExternalStore 和 hook 绑定；业务 TSX 只接收推导后的 props，不访问 ctx、不从 React context 偷取服务、不自己镜像外部快照。

| 输入 | 来源 | 用途 |
|---|---|---|
| PropsRuntime | SlotMap 与标准 scope provider | owner 参数、sessionId、会话/工作区 hooks |
| PropsRenderSlots | 当前 entry 的 children 声明 | 被授权的 renderSlot/renderSlotChain 与需要时的 SessionProvider |
| PropsStore | 当前注册的 store factory | useStore 与 actions |
| InjectFace | 注册处 inject 返回值 | 私有数据、回调及经框架绑定的 observables |
| PropsLocale | locale namespace | typed t |
| matched | chain select 的结果 | 已选中的请求或其他数据 |

不要手写已有 share 中的同名成员，也不要把整个 service、Context 或 ReactNode 作为跨域注入对象。框架现有兼容字段不是新代码扩大例外的依据。

## 槽的类型与所有权

| kind | 渲染规则 | 设计错误示例 |
|---|---|---|
| single | 同一 cell 只有优胜者，较小 priority 优先 | 将两个需要同时显示的组件放入 single |
| list | 不同 id 分别占 cell，再按 order 排序 | 把重复 id 当成追加新行 |
| keyed | owner 指定 entryKey 分派 | 忘记 key 注册或把 key 当 sessionId |
| chain | 按 priority 用纯 select(owner) 选第一个非 null | select 返回 undefined 作为“不命中”，或依赖框架自动补 owner 字段 |

root 是内置声明，只有渲染基础设施通过 service 渲染它。其余子槽必须同时存在 SlotMap 类型声明与某个 entry.children 运行期声明。只有该父 entry 获得渲染授权；知道字符串名字不等于有权渲染。

single/list/keyed 的同一 cell 不能注册相同 priority 来假装并列；当前 registry 会拒绝这种冲突。chain 的同优先级候选按注册次序处理，但业务选择仍应明确优先级和互斥条件，不能用偶然加载顺序定义产品行为。

跨插件注册使用 slots.inject 等待槽声明，并返回注册的 disposer。声明 owner 卸载后，其子槽与贡献会一起释放；恢复声明会重新注册。服务已经出现不证明槽已经出现。

scope 与 kind 独立：root 不依赖当前会话；session-maybe 可在无会话时渲染，但会话贡献值可为 undefined；session 要求真实 binding。欢迎区和首次输入不能误挂在严格 session 子树。

审批宿主的 owner 必须包含 sessionId 与 pendingInteraction；chain select 只读取调用方传给 renderSlotChain 的对象。留空对象会使卡片无法命中，不能靠组件内部再查请求弥补选举已失败。

## 响应式数据和 store

- render 读取会在 React 外变化的数据，必须通过框架 hook。事件回调可以读取快照，不意味着 render 也可以只 getSnapshot 一次。
- 私有 observable 放 inject.hooks，让框架生成 useName；业务代码不传自制订阅 hook。
- 派生数据用纯函数/useMemo，不再建立一个订阅 store 复制原数据。
- observable source 对象身份稳定；无变化时 snapshot 引用稳定。新建包装 source 应按 SessionBinding 缓存。
- store 使用 createXXXStore 工厂，在 apply 创建 handle，读 useStore、写 actions。禁止模块顶层可变 store；测试可直接 create 实例。
- 声明了 store 不等于它能跨任意卸载存活。明确 handle 创建位置、store 实例 owner、scope key、清理条件，并验证“root 释放后再注册”的实际保留结果。
- 布局、滚动意图、表单草稿可属于交互 store；Session 日志、队列权威和连接 generation 仍归官方模型。

## keyed 流式订阅

官方 ui-chat 的 entry.inject 返回 keyedHooks，分别从 nodes.source(key) 和 nodes.processSource(key) 获取每行 source。children 中的 CHAT_NODE_INJECT 提供的是子槽能力，不能替代父 entry 的 keyedHooks。

父组件接收框架绑定的 hook 后传递给行组件；不得臆造“注册了 keyed 子槽就自动拥有 useChatNode”。按 order 渲染稳定 key，单行订阅自己的变化。每 token 重新扫描历史、转换全部消息或重建所有 source 会破坏增量设计。

## 错误边界和切换

| 失败位置 | 当前机制 | qs 需要做什么 |
|---|---|---|
| single/keyed/list entry 渲染失败 | entry 错误处理可退位，耗尽候选可能留下错误面 | 局部可诊断与重试，不能只依赖根边界 |
| chain select 抛错 | 当前 renderer 记录并视为拒绝候选 | select 保持纯函数且 total，不能把异常当正常路由 |
| 已当选 chain 组件抛错 | 不退位为下一个候选 | 请求仍需明确错误呈现与恢复 |
| root 内部 React 失败 | 自建边界只覆盖其包住的树 | 注入真实渲染错误确认覆盖范围 |
| 模块加载/必需服务等待 | 发生在业务 React 边界之外 | 启动诊断、组合检查和配置恢复 |

释放奇术 root 时不能误卸载官方数据和交互请求持有者。CSS 和快捷键是否释放是独立问题；仅改变 root winner 不会自动撤销已安装 effect。

## 源码依据

- [Slots 参考](../../../docs/subsystems/slots.md)
- [UI 规则](../../../packages/client/AGENTS.md)
- [Slot registry](../../../packages/client/ui-slots/src/index.ts)
- [实际选举和错误处理](../../../packages/client/ui-renderer/src/client/scoped-slots.tsx)
- [Chat 注入](../../../packages/client/ui-chat/src/client/apply.ts)
- [Store 引擎](../../../packages/client/store/src/index.ts)

## 开发备注

当类型示例与实际编译结果不同，先查当前 ComposedProps/SlotMap，而不是复制旧类型别名。此文没有提供可以直接替代完整插件的伪实现。
