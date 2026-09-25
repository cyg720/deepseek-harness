# WebSearch 真实保存与部分失败验收

日期：2026-09-23。覆盖 WebSearch 配置和凭据的真实 Host 保存、独立结果及刷新恢复，不等同于第二优先或全仓最终验收。

## 隔离与故障注入

沿用官方 launchWebScaffold 的 deepSeekSearch 选项：搜索地址指向本机未提供搜索服务的端点，凭据引用采用随机 QS_SEARCH_UI 标识，数据归 scaffold 临时 Harness home。使用明确的假凭据字面量，不读取或修改真实密钥。测试不执行搜索或外部模型请求。

浏览器仅阻断第一次 credentials/set 网络请求；settings/mutate 不被模拟，必须由真实 Host 成功写入。此用例证明凭据传输失败时的 UI 行为，不声称覆盖所有 Host 拒绝分支；明确拒绝另有单元回归。

## 真实场景断言

1. 公开字段暂存后放弃恢复原值，密码框类型为 password 且初始为空。
2. 将 maxUses 改为 7 并输入测试凭据，等待真实配置成功回执。
3. 凭据网络请求失败后，同时显示“搜索配置已保存”和“凭据未确认写入”，保留失败凭据草稿。
4. 恢复凭据请求并重试，断言真实 credentials/set 的引用、字面量和成功回执；整个阶段 settings/mutate 只发送一次。
5. 写入成功后清除密码输入；整页刷新后 maxUses=7、凭据状态为已配置，密码框仍为空。

## 实际验证

| 范围 | 结果 | 日志 |
| --- | --- | --- |
| 正式 Web 设置场景 | 1 通过、14 跳过 | logs/repair-v1-search-save-browser.log |
| QS 全量测试及 coverage | 131 文件、735 用例通过；5214 语句、3836 分支、1664 函数、3754 行均 100% | logs/repair-v1-search-accept-all-qs.log |
| 全仓 Host/Client 类型检查 | 通过 | logs/repair-v1-search-save-browser-types.log |
| 修改的浏览器测试静态检查 | 通过 | logs/repair-v1-search-save-browser-lint.log |
| doc-sync 修正后复跑 | 34 通过、0 失败，54.68 秒 | logs/repair-v1-search-accept-doc-sync-recheck.log |

## 未完成范围

真实断线重连、多客户端配置/凭据引用变化的完整浏览器矩阵仍待完成；相关时序已有可控单元回归。剩余模型、权限、模型选择和代理预设等设置插件，以及完整安全依赖、性能和最终全仓验收仍待推进。未提交推送，没有保留新的官方原文件差异。

## 文档门禁发现并修正的问题

首轮 doc-sync 为 32 通过、2 失败。README 在 Model Experience 标题和规范子项之间误插实现说明，已移回实现章节。API 目录生成器受同名类型影响：QS 内部 ModelCatalog 覆盖官方同名类型识别，临时生成结果移除六个官方条目；尝试 SubagentCatalog 又与官方子代理目录同名，最终采用 QsSubagentModelCatalog/QsSubagentModelCatalogState。重新生成后官方 api-catalog.ts 相对 HEAD 差异为空，未接受删除官方条目的错误生成结果。此问题说明仅编译和覆盖率通过不能替代生成目录校验。
