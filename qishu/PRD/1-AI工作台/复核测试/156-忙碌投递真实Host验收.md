# 忙碌投递真实 Host 验收

日期：2026-09-23。范围：奇术输入框在忙碌主会话中的实际投递，不调用外部真实模型，不接入真实登录。

## 验收方法

使用正式 Web 组合、真实浏览器与 Host，官方可取消回放将一个真实请求保持为运行中。就绪文件位于每次测试创建的独立临时目录，通过实际就绪信号等待，不靠固定 sleep。测试结束关闭浏览器及 scaffold 后删除临时目录。

通过奇术输入框逐次发送，等待实际 /api/session/prompt 成功响应，验证请求中 mode 和完整文本，再读取该 Session 的持久化事件，要求 agent/inbox/spliced 的目标与对应文本吻合。最后检查草稿清空及页面异常为空。

| 忙碌 Enter 偏好 | 操作 | 请求 mode | 持久 Inbox 目标 |
| --- | --- | --- | --- |
| queue | Enter | queue | next-turn |
| queue | 发送按钮 | queue | next-turn |
| queue | Ctrl+Enter | steer | next-step |
| queue | Cmd+Enter | steer | next-step |
| steer | Enter | steer | next-step |
| steer | 发送按钮 | steer | next-step |
| steer | Ctrl+Enter | queue | next-turn |
| steer | Cmd+Enter | queue | next-turn |

在同一运行会话中从奇术通用设置修改偏好，并等待按钮从 Add to queue 更新为 Steer current turn，再验证后一组操作。八种组合均通过；模型流尚未完成，所以验证的是接收及持久排队目标，不宣称每条消息已被模型消费或生成回答。

## 结果

定向真实浏览器场景通过，用时 9.26 秒；命令按名称筛选，其余 19 项未运行。日志为 logs/repair-v1-busy-delivery-browser.log。定向 lint、Host 测试类型检查和空白检查通过，日志为 repair-v1-busy-delivery-lint.log、repair-v1-busy-delivery-types.log。

随后执行完整 interaction-roundtrip.e2e.ts，20 项真实浏览器交互场景全部通过，用时 99.07 秒；日志为 logs/repair-v1-busy-delivery-interactions.log。此结果覆盖该文件，并非全仓测试或第二优先全部验收。

## 后续

空草稿加速行为与命令菜单修饰键组合尚待补齐或验收；检查清单同步的异步卸载尚需可控时序验证。其他 D/W、依赖安全、性能及整体全量验收继续按原目标执行，W11 延期。仅修改 QS 自有浏览器测试和报告，没有新增官方原文件改动，未提交 Git。
