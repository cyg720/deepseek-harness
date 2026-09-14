# 技术边界参考

检索日期：2026-09-08。以下参考用于约束实现，不是对 up-sl-back 仓库现状的证明。
项目事实来源仍以用户提供材料、获准读取的真实仓库和获批决策为准。

| 主题 | 采用的边界 | 官方参考 |
|---|---|---|
| Agent Skills | 以 SKILL.md 为入口；元信息说明用途；较长模板/脚本按需加载 | https://agentskills.io/specification |
| 本机缓存 | file URL 下 localStorage 行为未被统一定义，不能作为唯一保存途径 | https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage |
| 原路径保存 | showSaveFilePicker 可用性与上下文受限，不作为离线版必要依赖 | https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker |
| CSP | 内嵌固定运行脚本可按哈希授权；同时保留安全内容构建，不能只依赖策略 | https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src |

本包内嵌 Mermaid 11.16.0，来源、SHA-256 与许可证见 [资源记录](../assets/mermaid/PROVENANCE.md)；集成 API 依据本地依赖的 `dist/mermaid.d.ts` 与 `dist/config.type.d.ts` 核对。上述参考页面、远程字体和图标包不参与离线运行。
浏览器交互测试的证据见随包报告，不能用参考文档替代实际测试。
