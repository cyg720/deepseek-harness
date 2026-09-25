# 当前全仓 Windows 回归失败分流

日期：2026-09-24。首次执行 `node node_modules/vitest/vitest.mjs run`，退出1，155.46秒。1421个测试文件中1383通过、29失败、9跳过；22283项中22129通过、63失败、1预期失败、90跳过。原始日志 logs/repair-v1-current-repo-tests.log。

逐条读取63条 FAIL 后的异常，共57条为 EPERM 创建符号链接失败，5条为原5000ms阈值超时，1条为 Windows PDF 打包验收缺少 npm_execpath。该归类来自实际错误，而非按文件名推测。直接启动 Vitest 没有提供 pnpm 脚本环境，也没有执行 test 脚本中的 build:native-system，因此这次运行不能替代仓库正式 test 命令。

## 非符号链接失败复验

使用 `pnpm run test`，保留原超时和断言，设置 --maxWorkers=4，选择原6项失败：PiAi 动态目录、macOS 签名环境、PDF 许可证打包、Worker 包清单、PowerShell 取消和 HTTP 地址固定。6个文件的6项全部通过、170项未选中，1.96秒，退出0，日志 logs/repair-v1-repo-six-recheck.log。该结果说明这些失败在此复验条件下不复现；并发量和启动环境同时变化，不能把全部原因唯一归为并发，也不能宣称全仓通过。

57项符号链接失败仍是当前 Windows 运行环境的未通过项。没有跳过这些安全测试、放宽路径检查或更改系统权限。为验证整体组合，已启动 `pnpm run test --maxWorkers=4`，日志 logs/repair-v1-current-repo-pnpm.log；结果尚待收取，不把上述定向通过拼接成全量通过。

## Linux 验证目录源码一致性

对 packages、apps、scripts、vendor、native 及根编译/测试/依赖配置生成6774条路径的 SHA256 清单，包含已跟踪删除记录，比较当前工作区与容器 /review。首次发现44处差异；GoalDock.tsx 经忽略行尾差异比较仍缺少清除确认实现，证明并非全部只是换行差异。不能据旧 Linux 报告外推当前组合已通过。

已同步38个源码、测试、文档和配置文件，再次核对剩6处：native/system/packages/entry/src 下四个 flock 编译产物，以及 packages/CLAUDE.md、vendor/CLAUDE.md。未将 Windows 原生产物复制到 Linux，也未覆盖指令别名文件。本核对范围不包含所有文档、Agent Notes、根快照及 Linux 多余未跟踪文件，所以不能表述为两棵仓库完全一致。记录见 logs/repair-v1-linux-source-differences.log 和 logs/repair-v1-linux-source-after.log。源码同步后仍须重建和全量复验，尚未取得新的 Linux 全量通过结论。

进一步核对 snapshots、docs、.agents、benchmarks、qishu/config 和 qishu/tests 共4298个路径，20处差异中同步19处，剩余 .agents/notes/implemented/CLAUDE.md 指令别名未覆盖，日志 logs/repair-v1-linux-support-differences.log 与 logs/repair-v1-linux-support-after.log。覆盖了本次比较范围内的当前快照和性能脚本；仍不把此结果扩大为 Linux 不存在多余文件的证明。

同步后启动 Linux `pnpm run build && pnpm run test:coverage --maxWorkers=4`，保留原逐文件覆盖率门槛，日志 logs/repair-v1-current-linux-build-coverage.log。运行结果待收取。该运行与 Windows 单元回归并行，耗时不用于性能结论。

## Windows 正式全仓复验结果

`pnpm run test --maxWorkers=4` 已结束，退出1，374.94秒。1421个文件中1388通过、24失败、9跳过；22283项中22135通过、57失败、1预期失败、90跳过。逐条解析57个 FAIL 异常，全部为 EPERM 创建符号链接失败，没有其他失败类别；此前5个超时及 npm_execpath 错误在此整套运行中未重现。

这仍是未通过的 Windows 验收，不能表述为“全仓全绿”。符号链接失败发生在测试准备或构造安全用例时，当前用户令牌能力不足以完成这些用例；未删除断言或提高权限，Linux 验证也不能替代 Windows 符号链接平台行为的最终证明。

## Linux 构建发现及修正

第一次 Linux 全量命令在 Client 类型构建中失败：新增 Composer 跨实例测试的 JSX sessionId 使用普通字符串，违反 SessionId 品牌类型。按已有测试约定给合成固定标识添加 SessionId 类型标记；没有放宽正式接口。Windows Client/Host 类型构建随后退出0，日志 logs/repair-v1-queue-incarnation-types-final.log。该错误在本轮新增测试中，之前时间点的类型通过不能覆盖它。

修正测试已同步 Linux，并重启完整 build→test:coverage 链，日志 logs/repair-v1-current-linux-build-coverage-fixed.log。前一轮在覆盖率开始前就失败，不能记为覆盖率运行通过或失败；新一轮尚待结果。

## Linux 最终结果

已收取上述命令的最终退出状态：退出0，完整构建及覆盖率链通过。1458个测试文件通过、11个跳过；23558项通过、1项预期失败、125项跳过，测试耗时396.46秒。覆盖率汇总的语句、分支、函数、行均100%，沿用现有逐文件门槛。跳过项目及真实浏览器、性能、平台权限场景不因该结果视为已验收；Windows的57项符号链接失败仍开放。此结果对应本报告说明的同步版本，随后增加的测试必须另行验证。
