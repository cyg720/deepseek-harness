/**
 * 文件职责：定义仓库工作区的 tsdown 构建入口、目标平台和 Typert 插件装配方式。
 * 技术维度：使用 tsdown ESM 配置，根据 DSH_BUILD_FACE 在宿主与浏览器客户端两种构建面间切换。
 * 产品维度：统一产出 Node 运行文件、类型入口和需要的浏览器资源，支撑 CLI 与 Web 客户端发布。
 * 逻辑维度：先严格解析构建面，再返回工作区、入口、输出、目标和插件等构建选项。
 * 关键边界：DSH_BUILD_FACE 只允许 host、client 或未设置；普通构建依赖已生成的 lib/types JavaScript。
 * 新手阅读建议：先看 isBuildFaceClient 的合法输入，再比较 client 为 true 和 false 时 entry 与 plugins 的差异。
 */
import { defineConfig } from 'tsdown'
import { typertPlugin } from './packages/typert/generator/lib/types/tsdown-plugin.js'

/** 判断是否执行客户端构建。@param value 环境变量值，只允许 undefined、host 或 client。@returns client 时为 true，其余合法值为 false。@example isBuildFaceClient('client') 返回 true。 */
function isBuildFaceClient(value: unknown): boolean {
  if (value === undefined || value === 'host') return false
  if (value === 'client') return true
  throw new Error(`tsdown: --env.DSH_BUILD_FACE must be host or client, received ${String(value)}`)
}

/**
 * The ordinary workspace build consumes JavaScript emitted by the Host
 * TypeScript project and runs Typert. The Client pass selects packages that
 * declare a browser bundle and lets their package-local configs emit both
 * their Node loader entry and browser artifact.
 */
/** 创建工作区构建配置。@param env tsdown 传入的环境变量映射。@returns 当前构建面对应的 tsdown 配置。@example DSH_BUILD_FACE=client 时不运行 Typert 插件。 */
export default defineConfig(({ env }) => {
  // 是否选择浏览器客户端构建面；值经过严格解析，不接受拼写错误。
  const client = isBuildFaceClient(env?.DSH_BUILD_FACE)
  return {
    // 参与统一构建的工作区路径；覆盖 vendored 包、产品包和 CLI 应用。
    workspace: ['vendor/*', 'packages/*/*', 'apps/cli'],
    // 客户端由包内配置提供入口；宿主构建消费 TypeScript 已生成的三个 JavaScript 入口。
    entry: client ? '' : ['lib/types/{index,invariant,startup}.js'],
    // 所有构建产物写入各工作区的 lib 目录。
    outDir: 'lib',
    // 仓库只发布 ESM 格式。
    format: ['esm'],
    // 默认运行平台是 Node；客户端包可在自身配置中补充浏览器产物。
    platform: 'node',
    // 编译目标与仓库支持的现代 Node 引擎保持一致。
    target: 'es2024',
    // 保留 tsdown 推导的扩展名，不强制改写文件后缀。
    fixedExtension: false,
    // 类型声明由 TypeScript 工程生成，tsdown 不重复生成。
    dts: false,
    // 多阶段构建共享 lib 目录，因此本阶段不能先清空已有产物。
    clean: false,
    // 仅宿主构建运行 Typert，并限定处理 host 类型面；客户端构建不加载插件。
    plugins: client ? [] : [typertPlugin({ mode: 'workspace', faces: ['host'] })],
  }
})
