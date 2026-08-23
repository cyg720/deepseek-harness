/**
 * ================================ 文件注释 ================================
 * 【文件职责】提供 micromark 语法扩展 mathCompatibility()：在官方 dollar 数学语法之外，
 *             兼容 TeX 定界符写法——\\(...\\) 行内数学、\\[...\\] 块级数学、以及同一行内的
 *             $$...$$ 显示数学块，同时复用 micromark-extension-math 的 token 词表。
 * 【技术维度】micromark 扩展体系：text 构造（backslashMathText）+ flow 构造
 *             （createMathFlow 工厂按定界符参数化）；状态机逐字符消费；partial 构造用于
 *             试探关闭围栏；factorySpace 处理行首缩进；nonLazyContinuation 处理块内续行。
 * 【产品维度】模型输出常混用 $、\\( \\)、\\[ \\] 等不同数学记号；只认 dollar 会让其它写法
 *             显示为乱码。本扩展让各种常见 TeX 写法都能正确渲染为公式。
 * 【逻辑维度】1) previousBackslash 防止把转义反斜杠当作定界符；2) tokenizeBackslashMathText
 *             行内 \\(...\\) 状态机；3) createMathFlow(marker, open, close, multiline) 工厂
 *             生成 \\[...\\] 与同行 $$...$$ 两种 flow 构造；4) 组装成 Extension 导出。
 * 【关键边界】必须与官方 math() 扩展同用（本扩展只发 token，由 math() 的 mdast 转换编译成
 *             标准 math 节点）；用 oddBackslashRun 奇偶计数避免转义反斜杠误闭合；
 *             \\[...\\] 支持多行、同行 $$ 块不支持多行。
 * 【新手阅读建议】先弄清"扩展只产 token、math() 负责编译成节点"的分工，再看 createMathFlow
 *             如何用三个参数生成两种围栏构造。
 * ==========================================================================
 */
/** Extend upstream dollar-only math syntax with TeX delimiters while reusing its token vocabulary. */

import { factorySpace } from 'micromark-factory-space'
import type {} from 'micromark-extension-math'
import { markdownLineEnding } from 'micromark-util-character'
import { codes, constants, types } from 'micromark-util-symbol'
import type { Construct, Extension, Previous, State, Tokenizer } from 'micromark-util-types'

// 下面的分词器需要把 this 暂存为局部变量（如 const self = this），因为 micromark
// 只在外层回调上绑定 tokenizer 上下文；此处按需禁用 no-this-alias 规则。
// oxlint-disable typescript/no-this-alias -- micromark binds tokenizer context only on the outer callback.

/** 前一个字符检查：反斜杠前面若紧跟另一个构成字符转义的反斜杠，则它不是数学定界符。 */
const previousBackslash: Previous = function (code) {
  if (code !== codes.backslash) return true
  const tail = this.events.at(-1)
  /* v8 ignore next -- a previous code necessarily has a preceding event. */
  if (tail === undefined) return false
  return tail[1].type === types.characterEscape
}

/**
 * 行内数学 \\(...\\) 的分词状态机：start 遇到反斜杠进入，open 要求紧跟左括号，
 * between / data 消费正文，遇到未转义的 \\) 时经 partial 构造闭合。
 */
const tokenizeBackslashMathText: Tokenizer = function (effects, ok, nok) {
  return start

  function start(code: number | null): State | undefined {
    /* v8 ignore next -- the text construct is dispatched only for a backslash. */
    if (code !== codes.backslash) return nok(code)
    effects.enter('mathText')
    effects.enter('mathTextSequence')
    effects.consume(code)
    return open
  }

  function open(code: number | null): State | undefined {
    // 反斜杠后必须是左括号才算数学定界符，否则整体失败（交给普通文本解析）。
    if (code !== codes.leftParenthesis) return nok(code)
    effects.consume(code)
    effects.exit('mathTextSequence')
    return between
  }

  function between(code: number | null): State | undefined {
    if (code === codes.eof) return nok(code)
    if (code === codes.backslash) {
      // 遇到反斜杠：先尝试闭合 \\)；失败则可能是转义内容或下一个数学的开头。
      return effects.attempt({ partial: true, tokenize: tokenizeClose }, close, afterCloseAttempt)(code)
    }
    if (markdownLineEnding(code)) {
      // 行内数学允许跨行：换行符作为 lineEnding token 消费后继续。
      effects.enter(types.lineEnding)
      effects.consume(code)
      effects.exit(types.lineEnding)
      return between
    }
    return dataStart(code)
  }

  function afterCloseAttempt(code: number | null): State | undefined {
    return effects.check({ partial: true, tokenize: tokenizeOpen }, nok, dataStart)(code)
  }

  function dataStart(code: number | null): State | undefined {
    effects.enter('mathTextData')
    effects.consume(code)
    return code === codes.backslash ? afterDataBackslash : data
  }

  function afterDataBackslash(code: number | null): State | undefined {
    if (code === codes.backslash) {
      effects.consume(code)
      return data
    }
    return data(code)
  }

  function data(code: number | null): State | undefined {
    if (code === codes.eof || code === codes.backslash || markdownLineEnding(code)) {
      effects.exit('mathTextData')
      return between(code)
    }
    effects.consume(code)
    return data
  }

  function close(code: number | null): State | undefined {
    effects.exit('mathText')
    return ok(code)
  }

  function tokenizeClose(closeEffects: Parameters<Tokenizer>[0], closeOk: State, closeNok: State): State {
    return slash

    function slash(code: number | null): State | undefined {
      /* v8 ignore next -- this partial construct is attempted only at a backslash. */
      if (code !== codes.backslash) return closeNok(code)
      closeEffects.enter('mathTextSequence')
      closeEffects.consume(code)
      return parenthesis
    }

    function parenthesis(code: number | null): State | undefined {
      if (code !== codes.rightParenthesis) return closeNok(code)
      closeEffects.consume(code)
      closeEffects.exit('mathTextSequence')
      return closeOk
    }
  }

  function tokenizeOpen(openEffects: Parameters<Tokenizer>[0], openOk: State, openNok: State): State {
    return slash

    function slash(code: number | null): State | undefined {
      /* v8 ignore next -- the opening check follows a failed close attempt at a backslash. */
      if (code !== codes.backslash) return openNok(code)
      openEffects.enter(types.chunkString)
      openEffects.consume(code)
      return parenthesis
    }

    function parenthesis(code: number | null): State | undefined {
      if (code !== codes.leftParenthesis) return openNok(code)
      openEffects.consume(code)
      openEffects.exit(types.chunkString)
      return openOk
    }
  }
}

/**
 * 生成一种"围栏式"数学 flow 构造的工厂：按定界符参数化——marker 是围栏字符，
 * openMarker / closeMarker 是开/关定界符，multiline 决定块内是否允许换行。
 * 调用处用它创建 \\[...\\]（多行）与同行 $$...$$（单行）两种构造。
 */
function createMathFlow(marker: number, openMarker: number, closeMarker: number, multiline: boolean): Construct {
  const tokenize: Tokenizer = function (effects, ok, nok) {
    const self = this
    // 记录"当前是否处于奇数个连续反斜杠"：偶数个反斜杠是转义内容，不能当作围栏关闭。
    let oddBackslashRun = false
    const tail = self.events.at(-1)
    // 记录行首缩进的宽度：续行时用 factorySpace 恢复同样的缩进，保持围栏内内容对齐。
    const initialSize = tail?.[1].type === types.linePrefix
      ? tail[2].sliceSerialize(tail[1], true).length
      : 0

    return start

    function start(code: number | null): State | undefined {
      /* v8 ignore next -- the flow construct is dispatched only for its marker. */
      if (code !== marker) return nok(code)
      effects.enter('mathFlow')
      effects.enter('mathFlowFence')
      effects.enter('mathFlowFenceSequence')
      effects.consume(code)
      return open
    }

    function open(code: number | null): State | undefined {
      if (code !== openMarker) return nok(code)
      effects.consume(code)
      effects.exit('mathFlowFenceSequence')
      effects.exit('mathFlowFence')
      return marker === codes.dollarSign ? afterDollarOpen : content
    }

    function afterDollarOpen(code: number | null): State | undefined {
      return code === codes.dollarSign ? nok(code) : content(code)
    }

    function content(code: number | null): State | undefined {
      if (code === codes.eof) return nok(code)
      if (code === marker && (marker !== codes.dollarSign || !oddBackslashRun)) {
        return effects.attempt(
          { partial: true, tokenize: tokenizeClosingFence },
          closed,
          afterClosingFenceAttempt,
        )(code)
      }
      if (markdownLineEnding(code)) {
        return multiline
          ? effects.attempt(nonLazyContinuation, afterContinuation, nok)(code)
          : nok(code)
      }
      return valueStart(code)
    }

    function afterClosingFenceAttempt(code: number | null): State | undefined {
      return marker === codes.backslash
        ? effects.check({ partial: true, tokenize: tokenizeOpeningFence }, nok, markerValueStart)(code)
        : markerValueStart(code)
    }

    function afterContinuation(code: number | null): State | undefined {
      return effects.attempt(
        { partial: true, tokenize: tokenizeClosingFence },
        closed,
        initialSize
          ? factorySpace(effects, content, types.linePrefix, initialSize + 1)
          : content,
      )(code)
    }

    function valueStart(code: number | null): State | undefined {
      effects.enter('mathFlowValue')
      oddBackslashRun = code === codes.backslash
      effects.consume(code)
      return value
    }

    function markerValueStart(code: number | null): State | undefined {
      effects.enter('mathFlowValue')
      oddBackslashRun = false
      effects.consume(code)
      return valueAfterMarker
    }

    function valueAfterMarker(code: number | null): State | undefined {
      if (code === marker) {
        effects.consume(code)
        return value
      }
      return value(code)
    }

    function value(code: number | null): State | undefined {
      if (code === codes.eof || code === marker || markdownLineEnding(code)) {
        effects.exit('mathFlowValue')
        return content(code)
      }
      oddBackslashRun = code === codes.backslash ? !oddBackslashRun : false
      effects.consume(code)
      return value
    }

    function closed(code: number | null): State | undefined {
      effects.exit('mathFlow')
      return ok(code)
    }

    function tokenizeClosingFence(
      closeEffects: Parameters<Tokenizer>[0],
      closeOk: State,
      closeNok: State,
    ): State {
      return factorySpace(closeEffects, sequenceStart, types.linePrefix, constants.tabSize)

      function sequenceStart(code: number | null): State | undefined {
        if (code !== marker) return closeNok(code)
        closeEffects.enter('mathFlowFence')
        closeEffects.enter('mathFlowFenceSequence')
        closeEffects.consume(code)
        return sequenceEnd
      }

      function sequenceEnd(code: number | null): State | undefined {
        if (code !== closeMarker) return closeNok(code)
        closeEffects.consume(code)
        closeEffects.exit('mathFlowFenceSequence')
        return factorySpace(closeEffects, after, types.whitespace)
      }

      function after(code: number | null): State | undefined {
        if (code !== codes.eof && !markdownLineEnding(code)) return closeNok(code)
        closeEffects.exit('mathFlowFence')
        return closeOk(code)
      }
    }

    function tokenizeOpeningFence(
      openEffects: Parameters<Tokenizer>[0],
      openOk: State,
      openNok: State,
    ): State {
      return sequenceStart

      function sequenceStart(code: number | null): State | undefined {
        /* v8 ignore next -- the opening check follows a failed close attempt at the marker. */
        if (code !== marker) return openNok(code)
        openEffects.enter(types.chunkString)
        openEffects.consume(code)
        return sequenceEnd
      }

      function sequenceEnd(code: number | null): State | undefined {
        if (code !== openMarker) return openNok(code)
        openEffects.consume(code)
        openEffects.exit(types.chunkString)
        return openOk
      }
    }
  }

  return {
    concrete: true,
    name: marker === codes.dollarSign ? 'sameLineDollarMathFlow' : 'backslashMathFlow',
    tokenize,
  }
}

/**
 * 非"惰性续行"检查：markdown 中位于列表等块内缩进位置的续行被称为 lazy 行，
 * 数学围栏内不允许 lazy 续行，此构造用于识别哪些换行后的行是合法续行。
 */
const tokenizeNonLazyContinuation: Tokenizer = function (effects, ok, nok) {
  const self = this

  return start

  function start(code: number | null): State | undefined {
    /* v8 ignore next -- continuation constructs are attempted only after a line ending. */
    if (code === codes.eof) return ok(code)
    /* v8 ignore next -- continuation constructs are attempted only after a line ending. */
    if (!markdownLineEnding(code)) return nok(code)
    effects.enter(types.lineEnding)
    effects.consume(code)
    effects.exit(types.lineEnding)
    return lineStart
  }

  function lineStart(code: number | null): State | undefined {
    // 当前行被 parser 标记为 lazy 时拒绝续行，否则接受。
    return self.parser.lazy[self.now().line] ? nok(code) : ok(code)
  }
}

const nonLazyContinuation: Construct = {
  partial: true,
  tokenize: tokenizeNonLazyContinuation,
}

// 行内数学 \\(...\\) 的 text 构造；previous 钩子防止转义反斜杠误开。
const backslashMathText: Construct = {
  name: 'backslashMathText',
  previous: previousBackslash,
  tokenize: tokenizeBackslashMathText,
}

// \\[...\\] 块级数学：允许多行，开/关定界符是方括号。
const backslashMathFlow = createMathFlow(
  codes.backslash,
  codes.leftSquareBracket,
  codes.rightSquareBracket,
  true,
)

// 同行 $$...$$ 显示数学：限定单行（multiline=false）。
const sameLineDollarMathFlow = createMathFlow(
  codes.dollarSign,
  codes.dollarSign,
  codes.dollarSign,
  false,
)

// 组合成的扩展：flow 阶段挂两个围栏构造，text 阶段挂行内数学构造。
const backslashMath: Extension = {
  flow: {
    [codes.backslash]: backslashMathFlow,
    [codes.dollarSign]: sameLineDollarMathFlow,
  },
  text: { [codes.backslash]: backslashMathText },
}

/**
 * TeX backslash delimiters and same-line display-dollar blocks as a micromark
 * syntax extension reusing `micromark-extension-math`'s token vocabulary; the
 * caller must also register `math()` on the same parse so the emitted tokens
 * compile to standard math nodes.
 * @returns The micromark syntax extension.
 */
/**
 * 生成"TeX 定界符兼容"micromark 语法扩展。复用 micromark-extension-math 的 token 词表；
 * 调用方必须在同一份解析上同时注册 math()，才能把发出的 token 编译成标准数学节点。
 * 使用示例：fromMarkdown(text, { extensions: [gfm(), cjkFriendlyStrong(), mathCompatibility(), math()] })。
 * @returns micromark 语法扩展对象。
 */
export function mathCompatibility(): Extension {
  return backslashMath
}
