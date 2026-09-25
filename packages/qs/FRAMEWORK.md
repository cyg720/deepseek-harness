# 奇术工作台插件结构

## 官方插件对应

第一优先及已落地的第二优先内容按官方界面插件职责逐项重写，自有登录独立保留。所有包位于 packages/qs，均是 Cordis 工作区插件，不是静态组件目录。

| 官方界面插件 | QS 插件 | 当前职责 |
|---|---|---|
| ui-layout | qs-shell | root、布局几何、顶层槽、全局样式和开发者界面切换 |
| ui-brand-official | qs-ui-brand | 独立品牌标识与名称，布局只提供槽位 |
| ui-sidebar | qs-ui-sidebar | 左导航骨架、导航空态、用户区与 qs.nav 子槽 |
| ui-workspace | qs-sessions | 会话列表、新建、切换、重命名、归档和本地置顶 |
| ui-conversation | qs-composer | Stage、欢迎区、输入、发送、停止、队列及会话子槽 |
| ui-chat | qs-transcript | 消息行、流式、转写视口、分页、锚点和阅读位置 |
| ui-approval | qs-approval | 审批呈现与官方回答动作 |
| ui-user-questions | qs-questions | 用户提问和方案审阅的呈现与回答 |
| ui-sidebar-right | qs-ui-sidebar-right | 会话右栏、正文/标题/菜单/向导槽及共享 docking 呈现 |
| ui-tool | qs-ui-tool | 工具过程与诊断行呈现，复用官方投影 |
| ui-input-trigger | qs-ui-input-trigger | 命令候选菜单与输入桥接 |
| ui-commands | qs-ui-commands | 命令选项、风险确认与冻结租约 |
| ui-permission-presets | qs-ui-permission-presets | 当前会话权限选项与新会话默认值，根界面切换释放/恢复对应装饰器 |
| ui-model-selection | qs-ui-model-selection | 独立模型呈现已编写并装配；生命周期、真实 Host 与完整验收待完成 |
| ui-agent-preset | qs-ui-agent-preset | 共享预设目录；新会话选择、会话标识、管理动作及 Web 装配待完成 |
| ui-message-feedback | qs-ui-message-feedback | 持久消息评价与会话反馈表单 |
| ui-sidebar-files | qs-ui-sidebar-files | 共享目录树、展开、刷新及资源导航；预览另设插件 |
| ui-deliverables | qs-ui-deliverables | 共享交付事实、文件预览、本机打开/定位与 present 工具卡；最终回答文件引用复用官方词表 |
| ui-schedule | qs-ui-schedule | 活动提醒只读投影、周期与本机时间；默认关闭，已验证真实投影回放和删除推送 |
| ui-goal | qs-ui-goal | 官方目标投影与实时激活、创建编辑/暂停恢复/清除、版本冲突保留草稿和目标命令历史 |
| ui-trajectory | qs-ui-trajectory | 官方请求快照、历史与实时输出；工具定位和图片已接线，完整验收待补 |
| ui-settings-plugins | qs-ui-settings-plugins | 父区域及动态标签已接线，四类配置卡仍待完成 |
| ui-settings-plugin-inventory | qs-ui-settings-plugin-inventory | 独立只读标签，复用官方清单 RPC 和预设目录；无写操作 |
| ui-theme 的外观与字号设置行 | qs-ui-theme | 两行独立贡献，复用官方主题服务与持久偏好；卸载仅释放呈现 |
| locale 的语言设置行 | qs-locale | 官方语言目录、即时选择与持久偏好委派；不复制语言服务 |
| ui-settings-general | qs-ui-settings-general | 设置壳、通用行、引导与本机配置文件入口；具体功能表单由独立插件贡献 |
| ui-subagent | qs-ui-subagent | 官方目录、地址导航及只读输入；组件覆盖率通过，完整子代理验收仍在进行 |
| ui-directory-picker-native | qs-ui-directory-picker-native | 独立原生目录流程，复用官方 OS 服务及 QS 双入口请求身份 |
| ui-jobs | qs-ui-jobs | 五态只读作业、控制流空态/陈旧提示和失败重试；复用官方状态 |
| ui-attachment | qs-ui-attachment | 已有消息/工具图片加载、重试和原图查看；轨迹贡献待宿主，新增上传后置 |
| ui-sidebar-documentpreview | qs-ui-sidebar-documentpreview | 共享内容宿主、分页/版本提示、纯文本/Markdown/代码/图片/HTML/PDF；本包覆盖率通过，完整验收仍待完成 |
| 无：自有新增 | qs-login | 静态登录演示；不承担后端认证 |

## 组合与状态

qs-shell 声明顶层布局槽；左右栏和会话是独立贡献插件。qs-ui-sidebar 声明 qs.nav，qs-composer 声明欢迎、转写和输入子槽，qs-transcript 声明消息行和交互子槽。插件以 slots.inject 等待声明，注册随父声明和自身生命周期撤销。

布局通过 owner props 传递几何状态，业务数据仍由官方 Session、输入机与交互服务持有。自有登录只是演示入口。官方 UI 保持可加载，由 defaultUi/showOfficialUiEntry 控制开发者切换；停用全部 QS 行与切换界面是两项不同操作。

跨包只用公开类型、槽和服务协作，不运行值导入其他 QS 插件组件。设计令牌仍由 qs-shell 注入；各插件拥有自己的字典、样式、测试与构建入口。

## 工程与验收

Web bundle 显式注册二十二个 QS 包（含默认关闭的日程插件），目录分支按能力另动态装配 qs-ui-directory-picker-native 或 qs-ui-directory-picker-browse，resolver dependencies、源码 paths、Client references 和 lockfile同步维护。第一优先的导航空态继续保留；右栏公共会话宿主已接入官方共享状态，第二优先业务正文及布局恢复尚未完整实现。

执行结果见 [整改验收](../../qishu/PRD/1-AI工作台/复核测试/17-第一优先官方插件对应整改与验收.md)，对应关系见 [计划修订](../../qishu/dev-components/第一优先开发计划评审/12-官方插件对应与整改验收.md)。构建或单元测试通过不代替全部质量门槛。

## 第二优先命令候选增量

`qs-ui-input-trigger` 独立对应官方 `ui-input-trigger` 的候选呈现，复用官方服务及会话控制器，通过 `qs.composer.overlay` 接入输入。命令选项弹层由独立 `qs-ui-commands` 贡献，两者不合并，也不重复实例化官方执行服务。

## 命令选项插件对应

`ui-commands → qs-ui-commands`：独立贡献命令选项和风险确认，复用官方 commandUi 唯一服务。选项加载、执行与草稿消费仍由官方控制器负责；QS 仅持有视图焦点和输入冻结租约。

## 消息反馈插件对应

`ui-message-feedback → qs-ui-message-feedback`：两项独立贡献分别挂接持久助手消息动作与会话表单，复用 `messageFeedbackPresentation`，不创建 FeedbackSurface，不重复装饰 `/feedback`。任务完成通知归布局消费者单独实施，不计入反馈插件完成项。

## 原生目录选择对应

`ui-directory-picker-native → qs-ui-directory-picker-native`：独立填充欢迎区及侧栏目录流程槽，复用官方 uiWorkspace 与唯一 Host OS provider。自动装配仅追加实际 native 分支；browse 分支由独立 qs-ui-directory-picker-browse 对应。组件按请求身份隔离旧回调，父槽或插件卸载时撤销贡献。

## 浏览式目录选择对应

`ui-directory-picker-browse → qs-ui-directory-picker-browse`：独立贡献双入口弹层，复用官方目录读取和创建服务。Host 返回完整路径，前端不拼接跨平台路径。创建操作不可撤销，取消只撤销后续导航；真实 Host 浏览器已验证读取、新建、取消与采纳；完整平台矩阵仍待完成。

模型设置新增独立 `qs-ui-settings-models`，对应官方 `ui-settings-models`，复用 `modelsSettings.face`。目前完成目录呈现、两类子扩展槽，以及 DeepSeek/pi-ai 端点与凭据连接编辑、供应商删除确认与部分失败重试、模型列表编辑与恢复继承、模型发现与候选采用、自定义供应商创建及已声明供应商名称与协议编辑。欢迎说明已独立注册并复用官方版本化文案及确认控制器；DeepSeek 凭据步骤已独立注册，只写凭据并复核共享目录就绪状态；已纳入正式 Web 装配并通过首次配置及端点持久化浏览器用例；自定义供应商增删改、凭据删除策略与刷新无引导闪现已通过真实 Host 浏览器验证；390px 模型发现、失败重试、长候选与防重复添加也已通过真实浏览器；两轮跨界面设置同步及双页面版本冲突保留草稿也已通过；其余设置验收未完成，不能计为 W10 完成。
