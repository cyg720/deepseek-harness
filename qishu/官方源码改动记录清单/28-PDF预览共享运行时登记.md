# PDF 预览共享运行时登记

官方 PDF 插件提供唯一页码状态和已有 worker/画布操作，QS 独立正文负责挂载与取消。上游升级需核对 worker 握手、画布上限、标签生命周期和服务导出。未改变 Host 读取权限或大小限制。

| 官方文件 | 原因与作用 | 是否必须 | 状态 |
|---|---|---|---|
| [packages/client/ui-sidebar-documentpreview/README.i18n.yaml](../../packages/client/ui-sidebar-documentpreview/README.i18n.yaml) | 同步共享 PDF 服务双语配对 | 是 | 已实现；定向行为与浏览器通过，覆盖率仍有缺口 |
| [packages/client/ui-sidebar-documentpreview/README.md](../../packages/client/ui-sidebar-documentpreview/README.md) | 说明 PDF 状态与运行时所有权 | 是 | 已实现；定向行为与浏览器通过，覆盖率仍有缺口 |
| [packages/client/ui-sidebar-documentpreview/README.zh.md](../../packages/client/ui-sidebar-documentpreview/README.zh.md) | 中文说明 PDF 状态与运行时所有权 | 是 | 已实现；定向行为与浏览器通过，覆盖率仍有缺口 |
| [packages/client/ui-sidebar-documentpreview/src/client/index.ts](../../packages/client/ui-sidebar-documentpreview/src/client/index.ts) | 导出 PDF 呈现类型并声明共享服务 | 是 | 已实现；定向行为与浏览器通过，覆盖率仍有缺口 |
| [packages/client/ui-sidebar-documentpreview/src/client/pdf/index.ts](../../packages/client/ui-sidebar-documentpreview/src/client/pdf/index.ts) | 官方与 QS 绑定唯一页码状态和标签释放登记 | 是 | 已实现；定向行为与浏览器通过，覆盖率仍有缺口 |
| [packages/client/ui-sidebar-documentpreview/tests/pdf-registration.client.spec.ts](../../packages/client/ui-sidebar-documentpreview/tests/pdf-registration.client.spec.ts) | 断言官方注册使用共享实例及卸载清理 | 是 | 已实现；定向行为与浏览器通过，覆盖率仍有缺口 |
| [packages/extensions/cordis-client-runner/src/client/slot-catalog.ts](../../packages/extensions/cordis-client-runner/src/client/slot-catalog.ts) | 生成独立 QS PDF 正文槽位目录 | 是 | 已实现；定向行为与浏览器通过，覆盖率仍有缺口 |

[工作区累计差异](28-PDF预览共享运行时差异.html)。快照基于 HEAD，可能包含此前未提交改动。QS 自有文件不登记。新增 pdf-registration 测试一项，其余均为已有记录。
