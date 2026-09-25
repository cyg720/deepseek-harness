# Vitest 安全补丁与全量回归

日期：2026-09-24。Vitest、coverage-v8 与 spy 的五份直接依赖声明统一从 ^4.1.8 调整为 ^4.1.11，锁文件中的 Vitest 关联包统一到 4.1.11。没有修改业务实现、测试用例、快照或覆盖率排除项。

## 原因与影响

上游 [GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9) 将 4.1.11 列为修复版本。已核实 registry 存在该版本，coverage-v8 要求同版 Vitest。公告涉及 redirect mock 文件读取，独立插件的无认证路径与 Browser Mode 的带令牌路径不同；本批作为测试工具链防御性修补，不声称默认工作台已复现该攻击。

修改根、apps/web、client-runtime、session-snapshot 与 remote-mock 的依赖声明，保持调用同一组测试和 spy API。对锁文件进行结构化比较：18 个 packages 键和 26 个 snapshots 键变化全部属于 Vitest；只改变上述五个 importer，override 和其他锁文件元数据不变。两个测试辅助包的 Vitest peer 解析改用已有的 @types/node 26.1.2，没有增加新的 Node 类型版本。原始差异为 `logs/repair-v1-vitest-lock.diff`。

## 执行证据

| 检查 | 状态 | 日志 |
| --- | --- | --- |
| lockfile-only 解析 | 退出 0；存在既有弃用包与 peer 提示 | `logs/repair-v1-vitest-lock.log` |
| Windows 冻结安装 | 退出 0，14.5 秒 | `logs/repair-v1-vitest-install.log` |
| Linux 冻结安装 | 退出 0，6.9 秒 | `logs/repair-v1-vitest-linux-install.log` |
| Windows typecheck | 退出 0 | `logs/repair-v1-vitest-types.log` |
| Linux 全量 test:coverage --maxWorkers=4 | 退出 0：1457 文件通过、11 跳过；23532 项通过、1 预期失败、125 跳过；四项 100%，404.20 秒 | `logs/repair-v1-vitest-full-coverage.log` |
| Linux 真实浏览器 transcript-follow | CI=true、DSH_SNAPSHOT=replay；9 项全部通过，38.63 秒，退出 0 | `logs/repair-v1-vitest-browser.log` |
| pnpm run doc-sync | 34 项通过、0 失败、0 跳过，339.29 秒，退出 0 | `logs/repair-v1-vitest-docs.log` |
| pnpm audit --json | 退出 1：0 critical、2 high、10 moderate、1 low | `logs/repair-v1-vitest-audit.json` |

本批六个官方原文件登记于 [105](../../../官方源码改动记录清单/105-Vitest工具链安全补丁登记.md)。总表 216 个唯一文件，路径排序与连续序号已校验；相关文件 git diff --check 退出 0。浏览器在同一 Linux 验证目录使用最新冻结安装，未刷新快照。测试覆盖率与文档门禁并发运行，耗时不作为性能基准。

扫描相较 [184](184-Mermaid文档依赖安全补丁.md) 减少两个中危条目，分别是 Vitest 和 @vitest/mocker 对同一公告的命中，不应表述为发现或关闭两个不同漏洞。剩余依赖公告继续保留，安全扫描尚未通过。

本批是现有依赖的机械补丁升级，不增加新的设计决策笔记。JSON 清单与生成锁文件不插入非法中文注释，原因、作用和上游影响登记于官方清单。没有提交或推送 Git；全量覆盖率沿用原有统计范围，包括 extensions 源码的既有排除；不声称被排除文件逐文件达到 100%。
