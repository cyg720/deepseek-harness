# Cordis 启动夹具接口补齐

日期：2026-09-23。范围：官方连接夹具与奇术构建装配回归。

## 核实与修改

官方 client-test-runtime 的 remoteDefaultResponses 已定义 dynamicCordisRunner/syncInspectManifest 返回成功 null、dynamicCordisRunner/inventory 返回成功空数组。旧 connection fixture 缺少这两个启动调用，导致诊断插件报接口不可用。本批按已有默认响应补齐，夹具不伪造动态包安装或检查查询能力，所有未知接口继续拒绝。

新增 tests/qs/inspect-boot.client.spec.ts，先验证缺失时失败，再验证成功响应与未知接口失败。新测试属于 QS 自有文件，不登记官方原文件；fixture 原文件及 README 三件套同批登记到 87-连接夹具Cordis启动接口登记.md，附 HEAD 至工作区累计差异与总表索引。

## 证据

连接夹具、命令夹具和新启动用例共 3 文件、48 项通过；负向日志为 logs/repair-v1-inspect-fixture-negative.log，修复后为 repair-v1-inspect-fixture-tests.log。包构建、定向 lint、Host 测试类型检查、翻译配对和改动空白检查通过。

重建连接包后，workbench-flow 的 3 项集成用例通过。此次 repair-v1-inspect-fixture-flow.log 不再出现两项接口缺失日志，也未出现 no active Connection；页面异常断言继续启用，没有抑制控制台错误。该结果只证明当前装配场景，不证明延迟同步与卸载之间没有潜在竞态。

完整 doc-sync 34 项通过、0 失败、0 跳过；日志为 logs/repair-v1-inspect-fixture-docs.log。

## 后续

仍需以可控异步时序核查检查清单同步在卸载后的行为。真实忙碌消息投递、空草稿加速与菜单仲裁、其余 D/W、安全、性能与最终全量验收按原范围继续。W11 延期，不接入真实登录。未提交 Git。
