# Vitest 工具链安全补丁登记

日期：2026-09-24。六个官方原文件，根清单和锁文件保留此前累计改动。

| 官方文件 | 是否必须改动 | 原因及作用 | 状态与验证 |
| --- | --- | --- | --- |
| [apps/web/package.json](../../apps/web/package.json) | 是 | Web 验收使用已修补 Vitest 4.1.11，与根工具链版本对齐 | 冻结安装、类型检查、全量 23532 项、浏览器 9 项及文档 34 项通过；覆盖率门禁四项 100% |
| [package.json](../../package.json) | 是 | 保留既有修补；同步 Vitest 与 coverage-v8 的安全补丁至 4.1.11 | 冻结安装、类型检查、全量 23532 项、浏览器 9 项及文档 34 项通过；覆盖率门禁四项 100% |
| [packages/test-support/client-runtime/package.json](../../packages/test-support/client-runtime/package.json) | 是 | 客户端测试运行辅助包使用已修补 Vitest 4.1.11 | 冻结安装、类型检查、全量 23532 项、浏览器 9 项及文档 34 项通过；覆盖率门禁四项 100% |
| [packages/test-support/remote-mock/package.json](../../packages/test-support/remote-mock/package.json) | 是 | 远程模拟辅助包 spy 与 Vitest 4.1.11 保持同版 | 冻结安装、类型检查、全量 23532 项、浏览器 9 项及文档 34 项通过；覆盖率门禁四项 100% |
| [packages/test-support/session-snapshot/package.json](../../packages/test-support/session-snapshot/package.json) | 是 | 会话快照辅助包使用已修补 Vitest 4.1.11 | 冻结安装、类型检查、全量 23532 项、浏览器 9 项及文档 34 项通过；覆盖率门禁四项 100% |
| [pnpm-lock.yaml](../../pnpm-lock.yaml) | 是 | 保留既有锁定内容，同步 Vitest 关联包与 peer 解析至 4.1.11 | 冻结安装、类型检查、全量 23532 项、浏览器 9 项及文档 34 项通过；覆盖率门禁四项 100% |

[累计差异](105-Vitest工具链安全补丁差异.html)。精确批次差异及测试终态见 [185](../PRD/1-AI工作台/复核测试/185-Vitest安全补丁与全量回归.md)。状态为工作区已修改、未提交。

中文注释例外：JSON 清单不支持注释，生成锁文件不手写注释；中文原因及作用由本表承载。上游影响为测试工具链及其辅助包依赖版本，没有修改运行时协议、插件职责、测试断言、快照或覆盖率配置。本批必须改动表示选择已安装安全补丁所需的直接声明与锁定，不表示默认产品已被证实可利用该公告。
