# MCP 与模型 SDK 间接依赖安全补丁

日期：2026-09-24。本批安装四项同主版本安全补丁，最新扫描为 **0 critical、2 high、0 moderate、0 low**。剩余两项均为 extract-zip；安全扫描仍退出 1，不能标记安全门禁已通过。

## 补丁与实际范围

| 依赖 | 安装前 → 安装后 | 核查及限制 |
| --- | --- | --- |
| hono | 4.12.29 → 4.13.5 | MCP SDK 带入服务端中间件。宿主 MCP 插件实际创建客户端 transport，不能把间接依赖存在当作默认工作台已暴露受影响 HTTP 服务；本批防御性升级。 |
| @hono/node-server | 1.19.14 → 1.19.15 | MCP SDK 的间接依赖；Windows 静态文件路径公告要求 serve-static 调用。没有将 MCP 客户端协议测试冒充该漏洞在产品中的复现。 |
| qs | 6.15.3 → 6.16.0 | Express/body-parser 和 union 的现有依赖引用改用修补版；不修改上层框架版本。 |
| protobufjs | 7.6.4 → 7.6.5 | Google 模型 SDK 间接依赖。公告涉及不可信 .proto 文本解析，不等价于普通模型响应或使用可信 schema 的二进制编解码。 |

依据：[Hono parseBody 公告](https://github.com/advisories/GHSA-g6gw-c38x-mqfc)、[Hono Node 静态文件公告](https://github.com/advisories/GHSA-frvp-7c67-39w9)、[qs 公告](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g)、[protobufjs 公告](https://github.com/advisories/GHSA-j3f2-48v5-ccww)。完整本批前后公告分别保存在 185 与本报告的 audit 日志中。

四项精确版本均经 registry 查询确认存在。在 pnpm-workspace.yaml 使用限定已有主版本的 override，附中文用途说明；pnpm-lock.yaml 由安装器生成。结构化对比确认 importer 无变化，packages 变化仅为上述四个旧版与新版；snapshots 还同步其 Google SDK、MCP SDK、Express、body-parser、union 调用者的依赖引用。没有升级这些调用者本身，也没有改变此前安全 override。精确差异为 `logs/repair-v1-protocol-security-lock.diff`。

## 验证记录

| 检查 | 实际结果 | 日志 |
| --- | --- | --- |
| lockfile-only 解析 | 退出 0 | `logs/repair-v1-protocol-security-lock.log` |
| Windows 冻结安装 | 退出 0 | `logs/repair-v1-protocol-security-install.log` |
| Linux 冻结安装 | 退出 0 | `logs/repair-v1-protocol-security-linux-install.log` |
| MCP、pi-ai、Claude 子代理相关测试 | 20 文件、484 项通过，退出 0 | `logs/repair-v1-protocol-security-tests.log` |
| MCP 本地真实协议 e2e | 22 项通过，退出 0；stdio、官方 everything/filesystem、Streamable HTTP | `logs/repair-v1-protocol-security-mcp-e2e.log` |
| Windows 全量 build | 退出 0；记录 302 个 Client 构建产物，仍有大于 500 kB 的包体积提示 | `logs/repair-v1-protocol-security-build.log` |
| pnpm run doc-sync | 34 项通过、0 失败、0 跳过，83.72 秒，退出 0 | `logs/repair-v1-protocol-security-docs.log` |
| pnpm audit --json | 退出 1，仅剩 extract-zip 两项 high | `logs/repair-v1-protocol-security-audit.json` |

这些测试不需要真实 API key；不能据此声称 Google 或其他线上模型 API 已验收。本批只变更依赖解析，不修改业务源码、测试断言、快照或覆盖率配置。此前 Vitest 全量覆盖率结果归 [185](185-Vitest安全补丁与全量回归.md)，不冒充本次依赖组合的全量测试结果。

## 仍未关闭的事项

extract-zip 当前可安装最新版仍为 2.0.1，直接桌面准备脚本的符号链接拒绝防护及回归见 [172](172-桌面ZIP安全缓解验证.md)。本次 audit 的两项公告均只列 apps__desktop>extract-zip 路径；源码搜索仅找到受限解压模块的直接导入及桌面清单声明。它没有从依赖闭包消失；此证据也不覆盖脱离该模块直接调用库、其他安装环境或将来新增的调用点。

本批官方原文件只有 pnpm-workspace.yaml 和 pnpm-lock.yaml，登记于 [106](../../../官方源码改动记录清单/106-MCP间接依赖安全补丁登记.md)，总表仍为 216 项。原型全状态、原生 Ctrl+F、其他性能场景及最终整体验收仍未关闭。没有提交或推送 Git。
