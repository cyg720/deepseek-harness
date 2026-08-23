# 源码中文注释工程 · 进度台账

> 临时跟踪文件，全部完成后删除。完成度的最终裁决标准是 `git diff --name-only` 与全量清单的比对结果。

## 规范摘要（下发子代理的统一模板）

- 文件顶部六段式横幅：【文件职责】【技术维度】【产品维度】【逻辑维度】【关键边界】【新手阅读建议】
- 元素注释：类/接口/类型/枚举、方法/函数（@param/@returns）、常量、成员变量、重要局部变量均加中文注释
- 位置规则：原有英文注释一字不动，中文注释放其正下方；无注释则直接新增
- 铁律：只新增注释行，不改任何代码、格式与结尾换行；排除 `*.test.ts` / `*.spec.ts` / `*.d.ts`

## 决策记录

- `vendor/` 为上游 SHA 锁定副本，按仓库 vendoring policy 不修改
- 测试文件不在范围；`test-support/*` 属于产品源码，纳入范围
- 分支 `doc`，起始基线干净（0 dirty）

## 轮次记录

| 轮次 | 目录范围 | 状态 |
| --- | --- | --- |
| R1 | core/session, core/system-prompt, core/tools, core/agent-loop, core/agent, core/scope, core/agent-default-model, core/agent-tool-presentation, session/session-persistence, session/session-persistence-jsonl | 进行中 |

## 已完成目录清单

（每轮完成后追加）
