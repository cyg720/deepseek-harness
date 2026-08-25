/**
 * 文件职责：实现 coverage-uncovered-locations.cjs 覆盖的仓库生成、校验或维护职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统、AST 或项目图分析。
 * 产品维度：保障源码、生成目录、文档和发布元数据在开发与 CI 中保持一致。
 * 逻辑维度：读取仓库输入，构建中间模型，执行生成或校验，再报告差异和失败。
 * 关键边界：生成结果必须确定；路径与源码文本不可信；校验失败必须以非零状态显式报告。
 * 新手阅读建议：先看命令入口和输入目录，再读模型转换，最后关注输出文件与失败条件。
 */
'use strict';

/**
 * Istanbul coverage reporter printing one clickable `path:line:col` record per
 * uncovered statement, branch path, and function. Vitest's per-file threshold
 * failures name only the file; this reporter supplies the exact locations,
 * printed just above those ERROR lines (reports run before threshold checks).
 * Files at 100% print nothing, so a green run stays silent.
 *
 * CommonJS by requirement: istanbul-reports loads custom reporters with a bare
 * require() outside the tsx/ESM pipeline (istanbul-reports index.js create()),
 * so this file can be neither TypeScript nor ESM. Wired into vitest.config.ts
 * by absolute path — require() would resolve a relative specifier against
 * istanbul-reports' own directory.
 */

/* 中文说明：变量 path 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const path = require('node:path');
const { ReportBase } = require('istanbul-lib-report');

/**
 * Editor-convention `line:column` of an istanbul location start (istanbul
 * columns are 0-based; editors and terminal link handlers expect 1-based).
 */
/* 中文说明：函数 pos 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function pos(loc) {
  return `${loc.start.line}:${loc.start.column + 1}`;
}

/** Whether a location carries a usable 1-based start line. */
/* 中文说明：函数 usable 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function usable(loc) {
  return Boolean(loc && loc.start && Number.isFinite(loc.start.line) && loc.start.line >= 1);
}

/**
 * ` (to line:col)` suffix when the range end adds information beyond the
 * start. v8-remapped whole-line statements carry end.column = Infinity; those
 * degrade to a line-only suffix, or to nothing on a single line.
 */
/* 中文说明：函数 endSuffix 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function endSuffix(loc) {
  /** 中文说明：变量 end 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const end = loc.end;
  if (!end || !Number.isFinite(end.line) || end.line < 1) return '';
  if (!Number.isFinite(end.column)) {
    return end.line === loc.start.line ? '' : ` (to ${end.line})`;
  }
  if (end.line === loc.start.line && end.column === loc.start.column) return '';
  return ` (to ${end.line}:${end.column + 1})`;
}

/** 中文说明：class UncoveredLocationsReport 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
class UncoveredLocationsReport extends ReportBase {
  constructor(opts = {}) {
    super(opts);
    // Vitest passes the resolved config root alongside reporter options.
    this.projectRoot = opts.projectRoot || process.cwd();
    this.records = [];
  }

  onStart() {
    this.records = [];
  }

  onDetail(node) {
    /** 中文说明：变量 fc 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fc = node.getFileCoverage();
    /** 中文说明：变量 rel 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const rel = path.relative(this.projectRoot, fc.path).split(path.sep).join('/');
    /** 中文说明：变量 items 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const items = [];
    /** 中文说明：函数值 add 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
    const add = (loc, text) => items.push({ line: loc.start.line, column: loc.start.column, text });

    /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
    for (const id of Object.keys(fc.statementMap)) {
      if (fc.s[id] !== 0) continue;
      /** 中文说明：变量 loc 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const loc = fc.statementMap[id];
      if (!usable(loc)) continue;
      add(loc, `${rel}:${pos(loc)} uncovered statement${endSuffix(loc)}`);
    }

    /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
    for (const id of Object.keys(fc.fnMap)) {
      if (fc.f[id] !== 0) continue;
      /** 中文说明：变量 fn 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fn = fc.fnMap[id];
      /** 中文说明：变量 loc 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const loc = usable(fn.decl) ? fn.decl : fn.loc;
      if (!usable(loc)) continue;
      /** 中文说明：变量 name 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const name = fn.name ? ` ${fn.name}` : '';
      add(loc, `${rel}:${pos(loc)} uncovered function${name}`);
    }

    /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
    for (const id of Object.keys(fc.branchMap)) {
      /** 中文说明：变量 counts 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const counts = fc.b[id];
      /** 中文说明：变量 branch 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const branch = fc.branchMap[id];
      /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
      for (let i = 0; i < counts.length; i += 1) {
        if (counts[i] !== 0) continue;
        // Implicit arms (e.g. a missing else) may carry an empty location;
        // fall back to the branch's own span so the record stays clickable.
        /** 中文说明：变量 loc 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const loc = usable(branch.locations && branch.locations[i]) ? branch.locations[i] : branch.loc;
        if (!usable(loc)) continue;
        add(loc, `${rel}:${pos(loc)} uncovered branch (${branch.type}, path ${i + 1}/${counts.length})`);
      }
    }

    if (items.length === 0) return;
    items.sort((a, b) => a.line - b.line || a.column - b.column);
    /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
    for (const item of items) this.records.push(item.text);
  }

  onEnd() {
    if (this.records.length === 0) return;
    console.log(`\nUncovered locations (per-file 100% gate): ${this.records.length}`);
    /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
    for (const record of this.records) console.log(record);
    console.log('');
  }
}

module.exports = UncoveredLocationsReport;
