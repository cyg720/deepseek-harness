#!/usr/bin/env node
/**
 * Prepack gate for entry packages: refuse to pack a tarball whose built
 * `lib/` is missing. Entry `files` lists use globs, and a glob matching
 * nothing packs a silently JS-less tarball instead of failing — this gate
 * turns that into a loud refusal on a checkout that never ran
 * `pnpm build:ts`.
 *
 * Runs from each entry package's `prepack` hook (pnpm sets the script cwd
 * to the package directory).
 */
/*
 * 文件职责：在原生入口包打包前确认必需的 JavaScript 与声明产物真实存在。
 * 技术维度：使用 Node.js 同步文件 API、包清单解析和进程退出码实现 prepack 门禁。
 * 产品维度：防止 files 通配符无匹配时仍生成缺少运行时代码的静默损坏 tarball。
 * 逻辑维度：读取当前包清单，遍历两个必需 lib 文件；任一缺失即报错退出，全部存在则成功。
 * 关键边界：脚本依赖 pnpm 把 cwd 设置为入口包目录；不会主动运行构建或修复产物。
 * 新手阅读建议：先看 packageDir 与 manifest 的来源，再看固定文件清单如何决定退出码。
 */

import fs from 'node:fs';
import path from 'node:path';

// packageDir：prepack 生命周期设置的当前入口包绝对目录。
const packageDir = process.cwd();
// manifest：当前入口包 package.json 的已解析对象，用于错误消息显示包名。
const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));

// file：当前必须存在的 lib 相对路径，仅检查运行时入口和类型声明入口。
for (const file of ['lib/index.js', 'lib/index.d.ts']) {
  if (!fs.existsSync(path.join(packageDir, file))) {
    console.error(`verify-entry-lib: ${manifest.name} has no ${file} — run \`pnpm build:ts\` before packing.`);
    process.exit(1);
  }
}
console.log(`verify-entry-lib: ${manifest.name} built lib/ present.`);
