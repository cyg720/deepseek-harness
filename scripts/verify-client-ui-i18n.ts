/**
 * Reject product UI copy embedded directly in Client source.
 *
 * Locale dictionaries are the only source files allowed to own translated
 * text. Presentation code receives copy through its typed `t` seat or through
 * an already-localized prop. This check covers JSX text and copy-bearing
 * attributes, plus the common data/helper forms that feed them.
 * @remarks 文件说明：文件职责：实现 仓库维护脚本 中 verify client ui i18n 模块的职责，并向相邻模块提供可复用能力。
 * ；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的 仓库维护脚本 能力，
 * 使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */

import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'

/**
 * 常量说明：root 用于处理 root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const root = resolve(import.meta.dirname, '..')
/**
 * 常量说明：MINIMUM_CLIENT_UI_SOURCES 用于处理 MINIMUM_CLIENT_UI_SOURCES 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const MINIMUM_CLIENT_UI_SOURCES = 450

/**
 * 常量说明：COPY_ATTRIBUTES 用于处理 COPY_ATTRIBUTES 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const COPY_ATTRIBUTES = new Set([
  'alt',
  'aria-description',
  'aria-label',
  'aria-valuetext',
  'cancelLabel',
  'closeLabel',
  'confirmLabel',
  'copyLabel',
  'description',
  'emptyLabel',
  'label',
  'placeholder',
  'title',
  'truncatedLabel',
])
/**
 * 常量说明：COPY_ATTRIBUTE_SUFFIX 用于处理 COPY_ATTRIBUTE_SUFFIX 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const COPY_ATTRIBUTE_SUFFIX = /(?:Aria|Copy|Description|Heading|Label|Message|Placeholder|Summary|Text|Title|Tooltip)$/

/**
 * 常量说明：COPY_NAME 用于处理 COPY_NAME 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const COPY_NAME = /(?:^|_)(?:aria|copy|description|empty|heading|label|message|placeholder|summary|text|title|tooltip)(?:s|_.*)?$/i
/**
 * 常量说明：COPY_SUFFIX 用于处理 COPY_SUFFIX 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const COPY_SUFFIX = /(?:aria|copy|description|empty|heading|label|labels|message|placeholder|summary|text|title|tooltip|tabs)$/i
/**
 * 常量说明：IMMUTABLE_LANGUAGE_TOKENS 用于处理 IMMUTABLE_LANGUAGE_TOKENS 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const IMMUTABLE_LANGUAGE_TOKENS = new Set([
  'B',
  'Function',
  'GB',
  'K',
  'KB',
  'M',
  'MB',
  'Symbol',
  'false',
  'function()',
  'n',
  'null',
  'true',
  'undefined',
])
/**
 * 常量说明：LOCALE_KEY 用于处理 LOCALE_KEY 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const LOCALE_KEY = /^[a-z][a-zA-Z0-9]*(?:[._-][a-zA-Z0-9]+)+$/

/** One hard-coded product-copy occurrence. */
export interface UiI18nViolation {
  /** One-based source column. */
  column: number
  /** Repository-relative source path. */
  file: string
  /** One-based source line. */
  line: number
  /** Why this literal is treated as product copy. */
  reason: string
  /** Compact literal text for the diagnostic. */
  text: string
}

/**
 * 功能说明：处理 localeOwner 相关流程；使用场景由所在模块及调用位置决定。
 * @param file （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
 * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 localeOwner(file)，并按返回类型处理结果。
 */
function localeOwner(file: string): boolean {
  /**
   * 常量说明：normalized 用于处理 normalized 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const normalized = file.replaceAll('\\', '/')
  /**
   * 常量说明：base 用于处理 base 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const base = normalized.slice(normalized.lastIndexOf('/') + 1)
  return base === 'locale.ts'
    || base === 'locales.ts'
    || normalized.includes('/locales/')
}

/**
 * 功能说明：处理 containsProductText 相关流程；使用场景由所在模块及调用位置决定。
 * @param text （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 containsProductText(text)，并按返回类型处理结果。
 */
function containsProductText(text: string): boolean {
  /**
   * 常量说明：normalized 用于处理 normalized 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized !== ''
    && !IMMUTABLE_LANGUAGE_TOKENS.has(normalized)
    && !LOCALE_KEY.test(normalized)
    && /\p{L}/u.test(normalized)
}

/**
 * 功能说明：处理 propertyName 相关流程；使用场景由所在模块及调用位置决定。
 * @param node （ts.PropertyName | ts.BindingName）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns string | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 propertyName(node)，并按返回类型处理结果。
 */
function propertyName(node: ts.PropertyName | ts.BindingName): string | undefined {
  return ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : undefined
}

/**
 * 功能说明：处理 copyAttribute 相关流程；使用场景由所在模块及调用位置决定。
 * @param name （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 copyAttribute(name)，并按返回类型处理结果。
 */
function copyAttribute(name: string): boolean {
  return !name.endsWith('Key')
    && (COPY_ATTRIBUTES.has(name) || COPY_ATTRIBUTE_SUFFIX.test(name))
}

/**
 * 功能说明：处理 compactText 相关流程；使用场景由所在模块及调用位置决定。
 * @param text （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 compactText(text)，并按返回类型处理结果。
 */
function compactText(text: string): string {
  /**
   * 常量说明：normalized 用于处理 normalized 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length <= 80 ? normalized : `${normalized.slice(0, 77)}...`
}

/**
 * 功能说明：处理 looksLikeNaturalText 相关流程；使用场景由所在模块及调用位置决定。
 * @param text （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 looksLikeNaturalText(text)，并按返回类型处理结果。
 */
function looksLikeNaturalText(text: string): boolean {
  /**
   * 常量说明：normalized 用于处理 normalized 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const normalized = text.replace(/\s+/g, ' ').trim()
  return /\s|[\u3400-\u9fff]/u.test(normalized) || /^[A-Z]/.test(normalized)
}

/**
 * Find hard-coded product copy in one Client source file.
 * @param file - repository-relative path used in diagnostics.
 * @param sourceText - TypeScript or TSX source.
 * @returns violations in source order.
 * @remarks 中文说明：功能说明：查找 Ui I18n Violations 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：file（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；
 * 参数说明：sourceText（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：UiI18nViolation[]；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * findUiI18nViolations(file, sourceText)，并按返回类型处理结果。
 */
export function findUiI18nViolations(file: string, sourceText: string): UiI18nViolation[] {
  if (localeOwner(file)) return []
  /**
   * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const source = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  /**
   * 常量说明：violations 用于处理 violations 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const violations = new Map<number, UiI18nViolation>()

  /**
   * 常量说明：report 用于处理 report 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 report 相关流程；使用场景由所在模块及调用位置决定。
   * @param node （ts.Node）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param text （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param reason （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param naturalOnly （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 report(node, text, reason, naturalOnly)，并按返回类型处理结果。
   */
  const report = (
    node: ts.Node,
    text: string,
    reason: string,
    naturalOnly = false,
  ): void => {
    if (
      !containsProductText(text)
      || (naturalOnly && !looksLikeNaturalText(text))
      || violations.has(node.getStart(source))
    ) return
    /**
     * 常量说明：position 用于处理 position 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const position = source.getLineAndCharacterOfPosition(node.getStart(source))
    violations.set(node.getStart(source), {
      column: position.character + 1,
      file,
      line: position.line + 1,
      reason,
      text: compactText(text),
    })
  }

  /**
   * 常量说明：collectExpression 用于收集 Expression 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   * 功能说明：收集 Expression 相关流程；使用场景由所在模块及调用位置决定。
   * @param node （ts.Expression）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param reason （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param naturalOnly （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 collectExpression(node, reason, naturalOnly)，
   * 并按返回类型处理结果。
   */
  const collectExpression = (
    node: ts.Expression,
    reason: string,
    naturalOnly = false,
  ): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      report(node, node.text, reason, naturalOnly)
      return
    }
    if (ts.isTemplateExpression(node)) {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：span（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(span)，并按返回类型处理结果。
       */
      report(
        node,
        [node.head.text, ...node.templateSpans.map(span => span.literal.text)].join(''),
        reason,
        naturalOnly,
      )
      return
    }
    if (ts.isCallExpression(node)) {
      // A call result is dynamic; copy-bearing arguments are visited through their own syntax.
      return
    }
    if (
      ts.isParenthesizedExpression(node)
      || ts.isAsExpression(node)
      || ts.isSatisfiesExpression(node)
      || ts.isNonNullExpression(node)
    ) {
      collectExpression(node.expression, reason, naturalOnly)
      return
    }
    if (ts.isConditionalExpression(node)) {
      collectExpression(node.whenTrue, reason, naturalOnly)
      collectExpression(node.whenFalse, reason, naturalOnly)
      return
    }
    if (ts.isBinaryExpression(node)) {
      if (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
        collectExpression(node.right, reason, naturalOnly)
      } else if (
        node.operatorToken.kind === ts.SyntaxKind.PlusToken
        || node.operatorToken.kind === ts.SyntaxKind.BarBarToken
        || node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      ) {
        collectExpression(node.left, reason, naturalOnly)
        collectExpression(node.right, reason, naturalOnly)
      }
      return
    }
    if (ts.isArrayLiteralExpression(node)) {
      /**
       * 变量说明：element 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const element of node.elements) {
        if (ts.isExpression(element)) collectExpression(element, reason, naturalOnly)
      }
      return
    }
    if (ts.isObjectLiteralExpression(node)) {
      /**
       * 变量说明：property 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const property of node.properties) {
        if (ts.isPropertyAssignment(property)) {
          /**
           * 常量说明：name 用于处理 name 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
           */
          const name = propertyName(property.name)
          /**
           * 常量说明：propertyOwnsCopy 用于处理 propertyOwnsCopy 相关数据，作用于当前作用域；初始化后不可重新赋值，
           * 但对象内部是否可变仍由其类型决定。
           */
          const propertyOwnsCopy = name !== undefined
            && (COPY_NAME.test(name) || COPY_SUFFIX.test(name))
          collectExpression(property.initializer, reason, naturalOnly || !propertyOwnsCopy)
        }
      }
    }
  }

  /**
   * 常量说明：enclosingFunctionName 用于处理 enclosingFunctionName 相关数据，作用于当前作用域；
   * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 enclosingFunctionName 相关流程；使用场景由所在模块及调用位置决定。
   * @param node （ts.Node）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns string | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 enclosingFunctionName(node)，并按返回类型处理结果。
   */
  const enclosingFunctionName = (node: ts.Node): string | undefined => {
    /**
     * 变量说明：current 用于处理 current 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let current = node.parent
    while (!ts.isSourceFile(current)) {
      if (ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current)) {
        return current.name === undefined ? undefined : propertyName(current.name)
      }
      if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
        /**
         * 常量说明：parent 用于处理 parent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const parent = current.parent
        return ts.isVariableDeclaration(parent) ? propertyName(parent.name) : undefined
      }
      current = current.parent
    }
    return undefined
  }

  /**
   * 常量说明：hasExplicitStringReturn 用于判断是否包含 Explicit String Return 相关数据，
   * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：判断是否包含 Explicit String Return 相关流程；使用场景由所在模块及调用位置决定。
   * @param node （ts.Node）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 hasExplicitStringReturn(node)，并按返回类型处理结果。
   */
  const hasExplicitStringReturn = (node: ts.Node): boolean => {
    /**
     * 变量说明：current 用于处理 current 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let current = node.parent
    while (!ts.isSourceFile(current)) {
      if (
        ts.isFunctionDeclaration(current)
        || ts.isMethodDeclaration(current)
        || ts.isArrowFunction(current)
        || ts.isFunctionExpression(current)
      ) return current.type?.kind === ts.SyntaxKind.StringKeyword
      current = current.parent
    }
    return false
  }

  /**
   * 常量说明：visit 用于处理 visit 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 visit 相关流程；使用场景由所在模块及调用位置决定。
   * @param node （ts.Node）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 visit(node)，并按返回类型处理结果。
   */
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) report(node, node.text, 'JSX text')

    if (ts.isJsxAttribute(node)) {
      /**
       * 常量说明：name 用于处理 name 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const name = node.name.getText(source)
      if (copyAttribute(name) && node.initializer !== undefined) {
        if (ts.isStringLiteral(node.initializer)) report(node.initializer, node.initializer.text, `${name} attribute`)
        else if (ts.isJsxExpression(node.initializer) && node.initializer.expression !== undefined) {
          collectExpression(node.initializer.expression, `${name} attribute`)
        }
      }
    }

    if (
      ts.isJsxExpression(node)
      && node.expression !== undefined
      && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
    ) collectExpression(node.expression, 'JSX child')

    if (file.endsWith('.tsx') && ts.isPropertyAssignment(node)) {
      /**
       * 常量说明：name 用于处理 name 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const name = propertyName(node.name)
      if (name !== undefined && (COPY_NAME.test(name) || COPY_SUFFIX.test(name))) {
        collectExpression(node.initializer, `${name} property`)
      }
    }

    if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
      /**
       * 常量说明：name 用于处理 name 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const name = propertyName(node.name)
      if (name !== undefined && (COPY_NAME.test(name) || COPY_SUFFIX.test(name))) {
        collectExpression(node.initializer, `${name} value`)
      }
    }

    if (ts.isBindingElement(node) && node.initializer !== undefined) {
      /**
       * 常量说明：name 用于处理 name 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const name = propertyName(node.name)
      if (name !== undefined && (COPY_NAME.test(name) || COPY_SUFFIX.test(name))) {
        collectExpression(node.initializer, `${name} default value`)
      }
    }

    if (ts.isReturnStatement(node) && node.expression !== undefined) {
      /**
       * 常量说明：name 用于处理 name 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const name = enclosingFunctionName(node)
      if (name !== undefined && (COPY_NAME.test(name) || COPY_SUFFIX.test(name))) {
        collectExpression(node.expression, `${name} return value`)
      } else if (file.endsWith('.tsx') && hasExplicitStringReturn(node)) {
        collectExpression(node.expression, 'string return value', true)
      }
    }

    ts.forEachChild(node, visit)
  }
  visit(source)
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：left（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：right（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(left, right)，并按返回类型处理结果。
   */
  return [...violations.values()].sort((left, right) => left.line - right.line || left.column - right.column)
}

/**
 * Resolve the normalized Client source root containing one TSX component.
 * @param file - Glob result using native or POSIX separators.
 * @returns Repository-relative `src/client` root, or undefined outside that tree.
 * @remarks 中文说明：功能说明：处理 clientSourceRoot 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：file（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：string |
 * undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * clientSourceRoot(file)，并按返回类型处理结果。
 */
export function clientSourceRoot(file: string): string | undefined {
  /**
   * 常量说明：normalized 用于处理 normalized 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const normalized = file.replaceAll('\\', '/')
  /**
   * 常量说明：marker 用于处理 marker 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const marker = '/src/client/'
  /**
   * 常量说明：index 用于处理 index 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const index = normalized.indexOf(marker)
  return index < 0 ? undefined : normalized.slice(0, index + marker.length - 1)
}

/**
 * 功能说明：处理 sourceFiles 相关流程；使用场景由所在模块及调用位置决定。
 * @returns string[]；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 sourceFiles()，并按返回类型处理结果。
 */
function sourceFiles(): string[] {
  /**
   * 常量说明：clientComponentRoots 用于处理 clientComponentRoots 相关数据，作用于当前作用域；
   * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：clientRoot（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：clientRoot is string；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(clientRoot)，并按返回类型处理结果。
   */
  const clientComponentRoots = new Set(
    globSync('packages/*/*/src/client/**/*.tsx', { cwd: root })
      .map(clientSourceRoot)
      .filter((clientRoot): clientRoot is string => clientRoot !== undefined),
  )
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：clientRoot（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(clientRoot)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：file（由 TypeScript
   * 根据调用位置推断的类型）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
   * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(file)，
   * 并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：file（由 TypeScript
   * 根据调用位置推断的类型）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
   * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(file)，
   * 并按返回类型处理结果。
   */
  return [...new Set([
    ...globSync('packages/client/*/src/**/*.tsx', { cwd: root }),
    ...globSync('packages/client/ui-*/src/**/*.{ts,tsx}', { cwd: root }),
    ...[...clientComponentRoots].flatMap(clientRoot =>
      globSync(`${clientRoot}/**/*.{ts,tsx}`, { cwd: root })),
    ...globSync('apps/web/src/**/*.{ts,tsx}', { cwd: root }),
  ])]
    .map(file => file.replaceAll('\\', '/'))
    .filter(file => !file.endsWith('.d.ts'))
    .sort()
}

/**
 * 功能说明：处理 main 相关流程；使用场景由所在模块及调用位置决定。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 main()，并按返回类型处理结果。
 */
function main(): void {
  /**
   * 常量说明：files 用于处理 files 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const files = sourceFiles()
  if (files.length < MINIMUM_CLIENT_UI_SOURCES) {
    throw new Error(
      `verify-client-ui-i18n: discovery narrowed to ${files.length} source file(s); expected at least ${MINIMUM_CLIENT_UI_SOURCES}.`,
    )
  }
  /**
   * 常量说明：violations 用于处理 violations 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：file（由 TypeScript
   * 根据调用位置推断的类型）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
   * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(file)，
   * 并按返回类型处理结果。
   */
  const violations = files.flatMap(file =>
    findUiI18nViolations(file, readFileSync(resolve(root, file), 'utf8')))
  if (violations.length > 0) {
    console.error(`verify-client-ui-i18n: ${violations.length} hard-coded UI string(s):`)
    /**
     * 变量说明：violation 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const violation of violations) {
      console.error(
        `  ${violation.file}:${violation.line}:${violation.column} ${violation.reason}: ${JSON.stringify(violation.text)}`,
      )
    }
    process.exitCode = 1
    return
  }
  console.log(`verify-client-ui-i18n: ${files.length} Client UI source file(s) use locale-owned copy.`)
}

if (import.meta.filename === resolve(process.argv[1] ?? '')) main()
