# Linux 隔离环境全量回归

日期：2026-09-24；本报告记录当前工作区在 Linux 的实际验证，不替代 Windows、生产部署、真实模型或原型全状态验收。仍未整体验收。

## 环境与输入

容器 `qs-review-20260924-sdk`，镜像 `qs-web-review-env:20260917`，Node v24.21.0、pnpm 11.11.0。宿主工作区按 Git 跟踪文件及未忽略文件清单复制到 `/review`，12,108 个文件、227,573,760 字节 tar（SHA-256：`f7984a4167f522a6126efca294ffe135af25fdd1bff44e4511b73a661fa646ea`）；恢复索引标记的符号链接和可执行位，未带入宿主 node_modules 或真实 .env 文件，未修改宿主安全设置。测试无真实 API 调用，不映射宿主端口。

已有镜像中的源码不是验证对象，测试命令均在新 `/review` 执行。依赖按当前锁文件 `pnpm install --frozen-lockfile` 安装；离线尝试因缓存无 pnpm 11.11.0 失败，正常联网安装随后通过。安装过程没有放宽锁文件。Host、Client 库及 Linux 原生模块分别构建通过。

## 快照结果

| 命令 | 结果 | 证据 |
| --- | --- | --- |
| Host 构建后 `pnpm run test:snapshot` | 113 通过、18 失败、2 跳过 | `logs/repair-v1-linux-session-snapshots.log` |
| 补齐 `build:lib:client` 后 SDK 定向复跑 | 17 通过、1 失败 | `logs/repair-v1-linux-sdk-snapshots-built.log` |

首轮 SDK 的 18 项失败由缺少 typert-registry、api-gateway 等 Client 构建阶段输出的 Host 入口引起，诊断日志确认 `ERR_MODULE_NOT_FOUND` 导致 Loader 回滚；不是 Windows 路径问题再现。补齐构建后 17 项通过，包括 text-turn、persistent-tools、ptc-turn、子代理、图片输入、连续轮次与系统提示历史。没有改写 Session 黄金文件或降低比较规则。

当前分范围证据合计 130 通过、1 失败、2 跳过，来源为两次命令，不能表述成一次全量命令 130 项通过。ACP、headless、语料检查来自首轮通过结果；SDK 来自第二轮。容器未安装 pwsh，2 项跳过由已有 platform=pwsh 判据触发，没有新增跳过规则；这两项继续依赖 Windows/pwsh 环境证据。

唯一 SDK 失败 `bash-tool`：当前容器虽有 bwrap，但文件沙箱后端不能实际使用，返回 `SANDBOX_UNAVAILABLE`。生产行为为拒绝无隔离执行，与录制的成功命令输出不匹配。没有改为 danger-full-access、启用 privileged、取消 seccomp 或将该用例跳过。仍需要具备可用文件沙箱的环境验证这项。

## 全仓覆盖率

`pnpm run test:coverage --maxWorkers=4` 已结束，退出 1；13 文件失败、1,439 文件通过、11 文件跳过；16 项失败、23,497 项通过、1 项预期失败、127 项跳过，共 23,641 项，391.84 秒。日志 `logs/repair-v1-linux-repository-coverage.log`。四个 worker 限制本机同时占用资源，不改变用例、覆盖率阈值或超时。此命令失败，不能宣称全仓逐文件覆盖率达标。

失败项后续分流及实际复跑如下：

| 根因 | 原失败数 | 处理与复跑 | 结论 |
| --- | --- | --- | --- |
| root 可读写 chmod 限制文件，且 Claude 产品拒绝 root 下的绕过模式 | 10 | 仅将隔离容器 `/review` 交给既有 node 用户，使用非 root 执行原用例；8 文件 363 项通过 | 原有权限负向断言及真实 Claude fixture 已通过，未修改源码或权限断言 |
| 源码副本没有 Git 索引与 HEAD | 3 | 复制原仓库的对象、索引、引用，排除 hooks 和远程配置；3 文件 117 项通过 | 未创建提交、未改宿主 Git，测试能读取原 HEAD 和实际文件清单 |
| WSL 内核被路径打开器识别为可访问 Windows 桌面 | 3 | 已读源码并独立复现，尚未修复 | `open-in-app/resolver` 1 项、`native-command/path-opener` 2 项仍失败 |

非 root 复跑：`logs/repair-v1-linux-nonroot-regression.log`；Git 元数据复跑：`logs/repair-v1-linux-git-metadata-regression.log`。这些是定向测试结果，不能替代修复剩余项后重新执行完整覆盖率命令。原有 Windows 57 项 EPERM 没有在本轮 Linux 结果中复现，但不能因此宣称宿主 Windows 权限已修复。

WSL 问题需要继续处理：`packages/util/native-command/src/path-opener.ts` 的 `isWsl()` 在环境标记为空时仍以 kernel release 包含 microsoft 判定 WSL。本容器内核为 `6.18.33.2-microsoft-standard-WSL2`，却不存在可用的 Windows 桌面互操作；因此可见原生打开入口和执行路径可能不正确。需要区分容器与真实 WSL 互操作，并补真实容器及显式平台事实的回归，不能只修改测试预期为 explorer。

新增报告的 `pnpm run verify-md-links` 已通过：1,704 份文档的相对引用和片段均有效，日志 `logs/repair-v1-linux-evidence-links.log`。

## 结论边界

Windows 的快照失败不等于同数量的业务缺陷；Linux 结果已经确认此前持久 shell、PTC、工具声明、路径及别名相关的多数差异具备平台关联证据。Windows SDK JSONL 路径转义本身仍是有效修复，详见 [175 根因记录](175-SDK快照启动失败根因与剩余差异.md)。符号链接权限、容器文件沙箱、真实 API、原型视觉与性能基线是不同验证条件，分别保留，不能相互替代。
