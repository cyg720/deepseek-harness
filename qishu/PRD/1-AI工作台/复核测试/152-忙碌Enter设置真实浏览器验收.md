# 忙碌 Enter 设置真实浏览器验收

日期：2026-09-23。范围：真实 Web 装配下的 QS 通用设置、Host 持久化、刷新恢复、跨界面同步及窄屏布局。没有发送模型 prompt，不接入真实登录。

## 验证结果

在既有 model-settings.e2e.ts 的首次配置场景中，通过奇术通用设置将 busyEnter 从 queue 改为 steer。直接读取隔离 Host 的 settings.yaml，轮询确认 busyEnter: steer 已写入。刷新并重新进入工作台后，设置行仍显示 steer。

两轮 QS→官方→QS 切换继续使用同一个 Host。在官方 General 中先观察此前的选项，再分别选择 Queue 和 Steer，并确认 Host 文件更新；返回奇术通用设置后显示对应的新值。原有模型端点跨界面同步和双页面冲突保护断言同时保留。

390×844 视口验证下拉框的左右边界处于视口内，设置容器 scrollWidth 不超过 clientWidth 加 1px。滚动至本行后截图人工检查，标签、说明与完整下拉框可见；说明换行、控件位于说明下方，未出现横向溢出。

## 执行证据

- 完整浏览器文件 3 项通过，用时 23.39 秒；logs/repair-v1-enter-setting-browser.log。
- 最后仅调整截图前滚动至目标控件，受影响场景再次通过，用时 12.80 秒；logs/repair-v1-enter-setting-browser-narrow.log。其余 2 项为明确筛选未运行，不能描述为重复全量通过。
- 定向 lint 与根 Host 测试类型检查通过；logs/repair-v1-enter-setting-browser-lint.log 和 logs/repair-v1-enter-setting-browser-types.log。
- 已查看真实截图 logs/repair-v1-enter-setting-narrow.png。初次截图目标行位于可滚动区域下方，因此增加滚动后重新截图，未修改产品布局。

## 尚待完成

本报告验证设置保存与共享，不证明模型运行期间 queue/steer 最终投递结果。发送按钮模式提示、空草稿加速手势、菜单仲裁组合及实际忙碌会话投递仍需完成或核查。其他 D/W、安全依赖、性能及整体全量验收保持原任务范围。W11 延期只保留说明入口；未提交 Git。本次只修改 QS 自有测试与报告，没有修改官方原文件。
