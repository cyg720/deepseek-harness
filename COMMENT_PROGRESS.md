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

## 重要教训（必须在新一轮提示词中传达）

1. **注释文本中禁止出现 `*/` 序列**（如 `assert*/validate*`、`materialize*/appendLines`）——它会提前闭合注释块，把后续注释行变成非法代码，导致 pre-commit lint 失败。写法上把 `*/` 拆开（如 `assert* / validate*`、`materialize*、appendLines`）。
2. **中文注释单行长度 ≤140 字符**（lint 的 max-len），超长必须拆成多行 JSDoc 块。
3. **注释缩进必须与上下文代码一致**（同属一个对象字面量成员时缩进对齐）。
4. **禁止复制代码**：给常量加注释时不得把常量声明复制一份（曾导致 `TOOL_ABORTED` 重复声明）。
5. 文件头中文注释块若插在原有 JSDoc 之后，注意原有 JSDoc 结尾 `*/` 与新块之间关系正常。
6. 禁改 `// oxlint-disable-*` 等 pragma 注释与目标行的相邻关系；中文注释只能加在其**上方**，不得插在 pragma 与目标行之间。

## 轮次记录

| 轮次 | 目录范围 | 状态 |
| --- | --- | --- |
| R1 | core/session, core/system-prompt, core/tools, session/session-persistence, session/session-persistence-jsonl | ✅ 完成（commit ebec78c98e，34 文件 +4392 行） |
| R2 | core/agent, core/agent-loop, core/scope, core/agent-default-model, core/agent-tool-presentation | 进行中 |

## 已完成目录清单

- packages/core/session/src（13 文件）
- packages/core/system-prompt/src（2 文件）
- packages/core/tools/src（10 文件）
- packages/session/session-persistence/src（6 文件）
- packages/session/session-persistence-jsonl/src（7 文件）
