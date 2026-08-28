/** Map one workspace source alias target to its declaration-build target. */
/*
 * 文件职责：把 TypeScript 工作区源码别名目标转换为文档类型检查使用的构建声明路径。
 * 技术维度：使用后缀判断、正则捕获和字符串切片覆盖包根、通配子路径、文件与目录入口。
 * 产品维度：让文档示例按发布后的 .d.ts 检查，避免依赖尚未公开的源码细节。
 * 逻辑维度：依次匹配 /src、/src/*、精确 .ts 文件和目录子路径，无法映射时明确抛错。
 * 关键边界：只接受仓库约定的 src 路径形式；不猜测其他目录或非 TypeScript 文件。
 * 新手阅读建议：按四个返回分支阅读，并比较每种输入如何替换为 lib/types。
 */
/**
 * 映射一个工作区源码别名目标到构建声明目标。
 * @param candidate - tsconfig paths 中的单个源码目标字符串。
 * @returns 对应的 lib/types 目录、通配路径或 .d.ts 文件路径。
 * @example builtDeclarationPath('./packages/core/session/src') 返回 './packages/core/session/lib/types'。
 */
export function builtDeclarationPath(candidate: string): string {
  // Two workspace path forms exist: whole-package entries end in /src, subpath
  // wildcards (browser-safe /types and /client channels) in /src/*.
  if (candidate.endsWith('/src')) {
    return `${candidate.slice(0, -'/src'.length)}/lib/types`
  }
  if (candidate.endsWith('/src/*')) {
    return `${candidate.slice(0, -'/src/*'.length)}/lib/types/*`
  }
  // sourceFile：精确源码文件匹配，第一组是包路径，第二组是 src 下相对入口且不含 .ts。
  const sourceFile = /^(.*)\/src\/(.+)\.ts$/.exec(candidate)
  if (sourceFile?.[1] && sourceFile[2]) {
    return `${sourceFile[1]}/lib/types/${sourceFile[2]}.d.ts`
  }
  // Directory subpath entries (for example, runtime's /client): the
  // source dir maps to the same dir under lib/types (index resolution applies).
  // 目录子路径（如 runtime/client）映射到 lib/types 下同名目录，并依赖 index 解析。
  // sourceDir：目录子路径匹配，捕获包路径和 src 下相对目录。
  const sourceDir = /^(.*)\/src\/(.+)$/.exec(candidate)
  if (sourceDir?.[1] && sourceDir[2]) {
    return `${sourceDir[1]}/lib/types/${sourceDir[2]}`
  }
  throw new Error(`doc-typecheck: cannot map workspace source path to built declarations: ${candidate}`)
}
