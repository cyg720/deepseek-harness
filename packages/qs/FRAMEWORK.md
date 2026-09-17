# 第一优先七插件框架

七个独立工作区包位于 `packages/qs/qs-*`。本文件保存框架说明，qs 目录作为包分组，不创建第八个包。该布局遵循仓库 `packages/*/*` 扫描规则。

| 包 | 预留职责 |
|---|---|
| [qs-shell](qs-shell/README.zh.md) | 应用外壳与开发者界面切换 |
| [qs-login](qs-login/README.zh.md) | 静态登录展示 |
| [qs-sessions](qs-sessions/README.zh.md) | 会话导航 |
| [qs-composer](qs-composer/README.zh.md) | 消息输入 |
| [qs-transcript](qs-transcript/README.zh.md) | 会话转写 |
| [qs-approval](qs-approval/README.zh.md) | 审批展示 |
| [qs-questions](qs-questions/README.zh.md) | 用户提问展示 |

每包包含 package.json、tsconfig.json、tsdown.config.ts、README 中英配对、src/index.ts、src/client/index.ts 与 tests/ 目录。Host/Client 入口均为空 apply；不注册槽、状态、页面、认证或接口，不启用开发者切换配置。测试目录只预留位置，不包含冒充功能验收的占位测试。

包按当前官方清单声明 publishConfig.access=public（本轮不执行发布），使用 ESM、Cordis peer/dev 依赖、官方 clientBundle 与客户端基础 TypeScript 配置。源码别名与客户端聚合引用进入仓库工程；默认 Web 组合不添加行或依赖，因此启动行为保持现状。正式开发时再依据实际导入添加依赖、声明槽、补测试并接入 Loader 组合。

[第一优先计划](../../qishu/dev-components/第一优先开发计划评审/00-评审总纲.md) 中的 M0 还包含 auth、样式与加载接线；本轮仅完成其工程框架部分，不代表 M0 整体通过。

## 框架检查记录

- 七包 TypeScript 构建、官方 tsdown Host/Client 打包通过。
- 七包构建产物的 Host 导入与 Client 模块工厂冒烟通过；两侧只导出空 apply，不请求运行依赖。
- 客户端包规则、依赖规则、源码别名、README Model Experience、Known Limitations、Agent Note 格式及八组中英配对检查通过。
- 工作区约束检查仅报告既有的 packages/code-runtime/code-runtime-python 缺少 package.json；没有修复该范围外目录，不声明全仓门禁通过。
- 没有页面或交互实现，因此没有执行 GUI、真实模型或端到端功能验收。
