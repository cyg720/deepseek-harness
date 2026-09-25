# 浏览式目录插件与真实 Host 接线

日期：2026-09-23。工作区未提交。范围为 G10/T43 的浏览式目录分支，不代表第二优先整体验收完成。

## 实现范围

独立 `qs-ui-directory-picker-browse` 对应官方 `ui-directory-picker-browse`。欢迎区与侧栏分别填充已有子槽；auto 根据官方能力选择，仅追加对应 QS 呈现，不重复 Host provider。固定浏览式 Web 测试显式装配该呈现。

界面支持 Host 完整路径、主目录、祖先/上级导航、隐藏目录、截断提示、空目录、读取失败重试、新建目录和选择确认。复用 `uiWorkspace.listDirectory/createDirectory`，不按浏览器平台拼接路径。目录读取失败不能确认此前成功列表的路径，错误提示不输出 Host 私有诊断。

每次打开请求拥有独立控制器与草稿；新扫描中止旧扫描且忽略其迟到成功或失败。创建操作没有撤销接口，关闭只能阻止后续导航，不能删除已经创建的目录。取消在扫描、新建和工作区采纳期间均可使用，父 owner 继续负责工作区登记及会话导航的请求身份。

## 验证状态

- 状态、DOM、双语和插件生命周期：3 文件 19 用例通过，单包四项逐文件覆盖率 100%。证据：`logs/repair-v1-browse-coverage.log`。
- Host/Client 类型检查通过，源码目录没有新增编译 JS 或 map。证据：`logs/repair-v1-browse-types-final.log`。
- QS 全量：104 文件、578 用例通过，逐文件四项 100%（语句 3799、分支 2800、函数 1235、行 2839）。证据：`logs/repair-v1-browse-all-coverage.log`。
- 真实浏览器专项：1 个用例通过，使用实际 Host 目录能力、私有临时目录和真实工作区/会话登记；验证读失败、新建后取消保留目录、换入口采纳及 760×820 视口边界。证据：`logs/repair-v1-browse-browser-final.log`；固定错误文案快照已人工核对。
- Lint、插件 bundle、diff --check 通过。文档门禁 34 项通过、0 失败、0 跳过（59.94 秒）。证据：`logs/repair-v1-browse-lint-final.log`、`repair-v1-browse-bundle.log`、`repair-v1-browse-diff-check.log`、`repair-v1-browse-doc-sync-final.log`。
- QS 浏览器组合：7 文件、25 用例全部通过（106.46 秒），包含浏览式、原生/auto、会话交互、轨迹、滚动和媒体用例。证据：`logs/repair-v1-browse-all-browser.log`。

初次 Web 验收暴露本地依赖链接未刷新，普通 pnpm 重复安装提前返回；使用 `pnpm install --offline --config.optimistic-repeat-install=false` 刷新后，resolver 链接和 lockfile 均包含新包，真实 Host 专项通过。初次文档门禁的换行符及中文标题问题已修复，最终 34 项重新通过。
- 官方文件登记：[第 47 批](../../../官方源码改动记录清单/47-浏览式目录插件接线登记.md)。

## 未完成范围

完整平台矩阵、真实 OS 原生窗口视觉、全部双界面验收及第二优先其他未完成项保持开放。本批未重新执行全仓库 hygiene；第 65 份记录中的 Windows ACP 符号链接环境问题仍未关闭。本地组件覆盖率不替代真实 Host 操作，也不证明全仓库覆盖率已达标。
