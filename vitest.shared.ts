/**
 * 文件职责：提供多个 Vitest 配置共享的 Node 参数和标准 TypeScript 装饰器预转换插件。
 * 技术维度：使用 TypeScript transpileModule、Vite pre 插件和正则清理编译器合成代码。
 * 产品维度：让源码模式测试可靠运行装饰器代码，并避免 Node Web Storage 遮蔽 jsdom 存储。
 * 逻辑维度：先探测装饰器语法；命中文件时转译 ES2024/ESM/JSX，标记合成访问器并返回 sourcemap。
 * 关键边界：只处理 TS/TSX 等文件且必须含装饰器；转换不是完整类型检查。
 * 新手阅读建议：先看 decoratorSyntax 与 vitestExecArgv，再逐步阅读 transform 的过滤、转译和清理。
 */
import ts from 'typescript'

// 判断源码是否可能包含标准装饰器的快速正则；仅作转译前筛选。
const decoratorSyntax = /^\s*@[A-Za-z_$][\w$]*/m

/**
 * Worker arguments that keep process-wide Web Storage from shadowing jsdom storage.
 * Node lists the positive spelling in `allowedNodeEnvironmentFlags` for this negatable flag.
 */
/** Vitest worker 使用的 Node 参数；支持 webstorage 标志的 Node 显式关闭进程级存储。 */
export const vitestExecArgv = process.allowedNodeEnvironmentFlags.has('--webstorage') ? ['--no-webstorage'] : []

/**
 * Transform standard TypeScript decorators before Vite's default parser sees source files.
 * @returns a pre-transform Vite plugin shared by source-mode test configurations.
 */
/** 创建标准装饰器预转换插件。@returns 多个源码测试配置共享的 Vite pre 插件。@example plugins: [standardDecoratorPlugin()]。 */
export function standardDecoratorPlugin() {
  return {
    name: 'dsh-standard-decorators',
    enforce: 'pre' as const,
    /** 转换含装饰器的 TypeScript。@param code 源码。@param id 带查询参数的模块 id。@returns 转换结果或不处理时的 undefined。 */
    transform(code: string, id: string) {
      // 去除 Vite 查询字符串后的实际文件路径。
      const file = id.split('?', 1)[0]!
      if (!/\.[cm]?tsx?$/.test(file) || !decoratorSyntax.test(code)) return
      // TypeScript 单文件转译结果，包含 JavaScript 与 source map 文本。
      const result = ts.transpileModule(code, {
        fileName: file,
        compilerOptions: {
          target: ts.ScriptTarget.ES2024,
          module: ts.ModuleKind.ESNext,
          jsx: file.endsWith('x') ? ts.JsxEmit.ReactJSX : undefined,
          sourceMap: true,
        },
      })
      return {
        code: result.outputText
          .replace(
            /^(\s*)(__esDecorate\()/gmu,
            '$1/* v8 ignore next -- compiler-synthetic decorator accessors have no source behavior */ $2',
          )
          .replace(/\n?\/\/# sourceMappingURL=.*$/u, '\n'),
        map: result.sourceMapText,
      }
    },
  }
}
