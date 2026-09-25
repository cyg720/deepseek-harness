# PDF 预览阶段验收

日期：2026-09-23。范围为官方 PDF 对应 QS 独立正文及共享页码、worker、画布操作。本报告不代表第二优先整体完成。

## 实现与官方对照

QS 复用官方 openPdf/renderPdfPage，保留真实 worker 握手、画布像素上限和标签释放。单独注册 PDF 子插件，与其余五类文档正文各自对应。可见页延迟绘制；内容替换、重试和卸载取消旧任务，页面重试使用新画布。密码错误和 worker 错误显示本地化说明，不回显原始异常。

官方当前没有独立缩放、密码输入和字节视图滚动恢复，QS 同样未承诺这些功能；页码偏好只用于选择先绘制的页面，不表示自动滚动到该页。

## 实际检查

- `pnpm run test -- packages/client/ui-sidebar-documentpreview/tests packages/qs/qs-ui-sidebar-documentpreview/tests --coverage --coverage.include=packages/qs/qs-ui-sidebar-documentpreview/src/**/*.ts --coverage.include=packages/qs/qs-ui-sidebar-documentpreview/src/**/*.tsx --coverage.include=packages/client/ui-sidebar-documentpreview/src/client/qs/pdf-presentation.ts`：40 文件、297 测试通过，但覆盖率门禁失败，命令退出 1。
- `node node_modules/typescript/bin/tsc -p tsconfig.client.json --noEmit`：通过。
- `node --import tsx scripts/run-oxlint.ts packages/qs/qs-ui-sidebar-documentpreview packages/client/ui-sidebar-documentpreview/src/client/qs/pdf-presentation.ts packages/client/ui-sidebar-documentpreview/src/client/pdf/index.ts apps/web/tests/qs/transcript-follow.e2e.ts`：修复三处测试类型/格式问题后通过。
- 两个文档预览包 `pnpm --filter ... run bundle`：通过。
- `node node_modules/vitest/vitest.mjs run --config vitest.web.config.ts apps/web/tests/qs/transcript-follow.e2e.ts -t 'preserves session tabs'`：1 通过，2 项因名称过滤跳过。真实文件树打开官方两页 PDF，检查两页中心像素分别为红和蓝，验证 worker 实际绘制；同时回归文本、Markdown、图片、HTML 和侧栏流程。
- `pnpm run test:docs`：16 门禁通过（本报告和登记追加前执行）。

## 覆盖率未通过项目

本次限定范围整体：语句 91.93%、分支 85.60%、函数 92.30%、行 95.19%。官方共享 PDF 工厂达到四项 100%，QS 尚有三个文件未达到逐文件 100%：

| 文件 | 语句 | 分支 | 函数 | 行 |
|---|---:|---:|---:|---:|
| packages/qs/qs-ui-sidebar-documentpreview/src/client/Preview.tsx | 92.04% | 84.84% | 95.45% | 95.23% |
| packages/qs/qs-ui-sidebar-documentpreview/src/client/text/index.tsx | 90% | 50% | 100% | 100% |
| packages/qs/qs-ui-sidebar-documentpreview/src/client/pdf/index.tsx | 80.23% | 78.18% | 77.77% | 85.10% |

PDF 主要缺口为 IntersectionObserver、取消后失败回调及注册注入。真实浏览器结果不计入此单测覆盖率统计，不能替代门禁。未降低门槛、未忽略文件。

## 证据与剩余范围

日志位于本目录 logs/repair-v1-qs-preview-pdf-{tests,coverage,typecheck,build,browser,docs}.log。官方原文件变更见 [28 登记](../../../官方源码改动记录清单/28-PDF预览共享运行时登记.md)。第二优先其他尚未实现的工作和全量验收仍继续，W11 按用户确认延期，仅保留说明入口。

后续补齐情况见 [42-文档预览分支与取消回归](42-文档预览分支与取消回归.md)；以上失败是首次检查的历史结果，不代表最新覆盖率。
