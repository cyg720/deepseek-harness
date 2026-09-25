# HTML 预览接线登记

共享 prepareHtml 复用官方 packHtml、read-relative 与 bootstrap；QS 只创建和释放 iframe Blob。未改变官方静态资源大小、数量、Host 路径权限或不透明 iframe 策略。

| 官方文件 | 原因与作用 | 是否必须 | 状态与上游影响 |
|---|---|---|---|
| [packages/client/ui-sidebar-documentpreview/README.i18n.yaml](../../packages/client/ui-sidebar-documentpreview/README.i18n.yaml) | 同步双语配对记录 | 是 | 已实现，定向测试及浏览器通过；上游升级时核对 HTML 安全限制和读取协议 |
| [packages/client/ui-sidebar-documentpreview/README.md](../../packages/client/ui-sidebar-documentpreview/README.md) | 说明共享 HTML 打包能力及 Blob 所有权 | 是 | 已实现，定向测试及浏览器通过；上游升级时核对 HTML 安全限制和读取协议 |
| [packages/client/ui-sidebar-documentpreview/README.zh.md](../../packages/client/ui-sidebar-documentpreview/README.zh.md) | 同步共享 HTML 打包能力说明 | 是 | 已实现，定向测试及浏览器通过；上游升级时核对 HTML 安全限制和读取协议 |
| [packages/client/ui-sidebar-documentpreview/src/client/index.ts](../../packages/client/ui-sidebar-documentpreview/src/client/index.ts) | 为共享 HTML 准备绑定源文档会话和官方 readRelated 接口 | 是 | 已实现，定向测试及浏览器通过；上游升级时核对 HTML 安全限制和读取协议 |
| [packages/client/ui-sidebar-documentpreview/tests/apply.client.spec.ts](../../packages/client/ui-sidebar-documentpreview/tests/apply.client.spec.ts) | 验证真实注册的关联读取载荷、取消及共享 HTML 准备 | 是 | 已实现，定向测试及浏览器通过；上游升级时核对 HTML 安全限制和读取协议 |
| [packages/extensions/cordis-client-runner/src/client/slot-catalog.ts](../../packages/extensions/cordis-client-runner/src/client/slot-catalog.ts) | 生成 QS HTML 子插件正文目录 | 是 | 已实现，定向测试及浏览器通过；上游升级时核对 HTML 安全限制和读取协议 |

[累计差异](27-HTML预览接线差异.html)。QS 新文件不计入官方原文件；本批六项均已登记，总数不变。PDF 和完整 C9 验收尚未完成。
