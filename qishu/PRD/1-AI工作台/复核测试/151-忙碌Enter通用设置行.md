# 忙碌 Enter 通用设置行

日期：2026-09-23。范围：奇术通用设置中的忙碌 Enter 选择器。整体第二优先验收未完成。

## 实现

qs-composer 对应官方 ui-conversation 注册 id 为 composer-enter、order 为 20 的独立通用设置行。读取 conversationPresentation.submission.busyEnter，选择后调用其 setBusyEnter，不维护第二份偏好状态。呈现采用奇术通用设置已有的标签、说明和原生下拉控件布局，使用 QS 颜色令牌；700px 以下上下排列。中英文文案归本包字典所有。

qs-composer 增加对 qs-ui-settings-general 的类型依赖和编译引用，离线安装已完成。生成插件目录已更新。官方锁文件和生成目录的改动记录在 86-忙碌Enter设置行接线登记.md；本批不增加官方原文件总数。没有修改官方偏好保存逻辑。

## 验证

DOM 验证两种语言下 queue 和 steer 的选择载荷，以及共享状态更新后控件值变化。真实 SlotRegistry 测试验证对应注册 id/order、共享可观察源对象身份、调用共享设置动作，并验证插件卸载后设置行消失。

输入包及共享 Host 入口共 12 个文件、79 项测试通过；语句 518/518、分支 348/348、函数 168/168、行 374/374，四项覆盖率均为 100%。正式 pnpm run typecheck、输入包 tsdown 构建、定向 lint、翻译配对和改动空白检查通过。lint 首次仅发现箭头参数缺少括号，已修正并重跑通过。

完整 doc-sync 34 项通过、0 失败、0 跳过。

证据日志前缀：logs/repair-v1-enter-setting-，包括 install、catalog、coverage、types、lint、build、pairing 和 docs。

## 未完成验收

尚未执行本设置行的真实浏览器保存、刷新、跨界面和窄屏验收。发送按钮仍需显示投递模式提示，空草稿加速手势和命令菜单组合行为仍需核查；不能据此认定整个发送偏好功能完成。其余 D/W、依赖安全、性能与全量回归按原任务继续，W11 延期、不接真实登录。未提交 Git。
