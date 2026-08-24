/**
 * Compatibility entry point for the unified Typert-backed Cordis catalog
 * projection. The generated API module retains this command in its banner,
 * while all extraction, validation, and rendering live in one implementation.
 */
/**
 * 文件职责：保留旧命令名，并把 Cordis API 生成请求转交统一目录生成器。
 * 技术维度：使用 ESM 导入复用 `gen-cordis-catalog.ts` 的主函数。
 * 产品维度：贡献者可继续使用稳定命令，同时所有文档生成逻辑只有一个实现。
 * 逻辑维度：导入 `main` 后立即执行，不在本文件解析参数或渲染内容。
 * 关键边界：这是兼容入口，禁止复制生成逻辑；错误和退出码由统一实现负责。
 * 新手阅读建议：先确认这里只转发，再到 gen-cordis-catalog.ts 阅读完整流程。
 */

import { main } from './gen-cordis-catalog.ts'

/** 执行统一目录生成器；参数从进程命令行读取，结果通过文件和退出码体现。 */
main()
