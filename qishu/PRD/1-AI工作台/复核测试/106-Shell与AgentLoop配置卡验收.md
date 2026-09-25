# Shell 与 AgentLoop 配置卡验收

日期：2026-09-23。范围：独立 `qs-ui-settings-plugins` 内对应官方两个配置卡的贡献。W10 设置功能尚未完整，第二优先整体未验收；未接入真实登录，W11 保持延期。

## 行为与源码对应

官方 `ui-settings-plugins` 内的 Shell、AgentLoop 卡分别对应 QS 的 `shell`、`agent-loop` keyed 贡献，未合并服务或复制 Host 设置权威。呈现使用 QS 表单样式；数值校验通过注入的官方 settingsSchema 服务消费 Host schema，没有另行硬编码参数范围。

Shell 提供命令超时和单流输出上限，AgentLoop 提供并行工具调用上限。草稿暂存于卡片，保存使用最初编辑版本和一个原子操作数组。冲突、拒绝保留草稿；用户核对当前值后可明确采用当前版本重试。恢复继承发送 unset；只读禁用写入；同批事件及异步保存期间不重复提交；释放旧实例后不采用迟到回执。

## 本轮实际验证

| 验证 | 结果 | 证据日志 |
| --- | --- | --- |
| 配置包 DOM、生命周期、提交器与覆盖率 | 5 文件、12 用例；203 语句、131 分支、66 函数、127 行均 100% | logs/repair-v1-numeric-coverage.log |
| QS 全量测试及覆盖率 | 124 文件、714 用例通过；4788 语句、3513 分支、1560 函数、3515 行均 100% | logs/repair-v1-numeric-all-qs.log |
| 全仓 Host/Client TypeScript | 通过；修正测试夹具违反 exactOptionalPropertyTypes 的显式 undefined | logs/repair-v1-numeric-root-types.log |
| 配置包及相关浏览器测试静态检查 | 通过 | logs/repair-v1-numeric-lint.log |
| 配置包 tsdown 构建 | 通过，浏览器消费此次构建 | logs/repair-v1-numeric-build.log |
| 真实 Host 浏览器设置场景 | 1 通过、14 跳过；非整组浏览器验收 | logs/repair-v1-numeric-browser.log |
| README 与 Agent Note 双语配对 | 两份配对通过 | logs/repair-v1-numeric-pairing.log |
| 官方槽目录生成 | 完成，两张卡注册；原文件登记见第 66 批 | logs/repair-v1-numeric-catalog.log |
| 客户端包规则 | 51 个客户端包通过 | logs/repair-v1-numeric-client-packages.log |
| doc-sync 文档全门禁 | 34 通过、0 失败、0 跳过，52.42 秒 | logs/repair-v1-numeric-doc-sync.log |

浏览器通过正式测试 profile 启动，使用隔离数据目录和静态登录。Shell 设置 timeoutMs=120000、maxOutputBytes=65536，AgentLoop 设置 maxParallelToolCalls=4；逐一等待 /api/settings/mutate 成功回执并校验响应数值，整页刷新后重新打开配置并断言持久值。旧“无配置卡”快照已删除，新增两张配置卡标题快照并核对内容。真实用户设置未被测试覆盖。

## 未完成范围

WebSearch、SubagentModelSelection 配置卡与其凭据部分失败、目录刷新和连接代际行为仍需实现；模型、权限、模型选择、代理预设等剩余对应插件仍待推进。安全依赖可达性复查、长会话性能基准及最终全仓验收不能由本轮 QS 测试代替。
