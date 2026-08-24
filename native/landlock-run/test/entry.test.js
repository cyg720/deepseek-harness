/**
 * Keyless entry-package tests — run on every host, no kernel or binary
 * required. Cover the JavaScript API's pure surface: grant-argv construction, the
 * resolution contract (platform package → fallback), and probe verdicts over
 * fake launchers. Requires built `lib/` (`pnpm build:ts`).
 */
/**
 * 文件职责：无密钥验证 Landlock JavaScript 入口包的纯 API、平台路径解析和探测结果解析。
 * 技术维度：使用 Node.js assert 与临时文件模拟启动器，通过依赖注入隔离包解析逻辑。
 * 产品维度：确保所有主机都能验证命令参数稳定性及缺少原生能力时的安全降级。
 * 逻辑维度：依次校验常量、授权参数、平台包路径、回退路径，并在 POSIX 主机上驱动多个假启动器。
 * 关键边界：不要求真实内核或二进制；Windows 跳过依赖 POSIX Shell 的假启动器部分；需要预先构建 lib。
 * 新手阅读建议：按断言分段顺序阅读，重点观察 grantArgs 输入输出以及 launcherPath 的解析注入点。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  LAUNCHER_BIN,
  LAUNCHER_FAILURE_EXIT,
  grantArgs,
  launcherPath,
  probe,
} from '@deepseek-ai/node-addon-landlock-run';

// --- constants are part of the CLI contract ---
assert.equal(LAUNCHER_BIN, 'landlock-run');
assert.equal(LAUNCHER_FAILURE_EXIT, 125);

// --- grantArgs: flag spelling, ordering, and empty grants ---
assert.deepEqual(grantArgs({}), []);
assert.deepEqual(grantArgs({ readOnly: ['/'] }), ['--ro', '/']);
assert.deepEqual(
  grantArgs({ readOnly: ['/', '/opt'], readWrite: ['/tmp/work'] }),
  ['--ro', '/', '--ro', '/opt', '--rw', '/tmp/work'],
);
assert.deepEqual(grantArgs({ readWrite: ['/a'], readOnly: ['/b'] }), ['--ro', '/b', '--rw', '/a']);

// --- launcherPath: resolves the platform package next to its package.json ---
// 当前进程平台应使用的可选平台包名称。
const platformPackage = `@deepseek-ai/node-addon-landlock-run-${process.platform}-${process.arch}`;
// 通过可控解析函数得到的启动器路径，用于验证正常解析分支。
const resolvedViaSeam = launcherPath((specifier) => {
  assert.equal(specifier, `${platformPackage}/package.json`);
  return path.join('/fake-install', specifier);
});
assert.equal(resolvedViaSeam, path.join('/fake-install', platformPackage, 'bin', LAUNCHER_BIN));

// --- launcherPath: unresolvable package falls back to an absolute, package-boundary path ---
// 当平台包无法解析时返回的绝对回退路径。
const fallback = launcherPath(() => {
  throw new Error('not installed');
});
assert.ok(path.isAbsolute(fallback), 'fallback path must be absolute');
assert.ok(
  fallback.includes(path.join('node_modules', ...platformPackage.split('/'), 'bin', LAUNCHER_BIN)),
  `fallback must point at the platform package layout: ${fallback}`,
);

// --- launcherPath: default resolution agrees with this workspace's layout ---
// 使用真实模块解析规则得到的默认启动器路径。
const defaultPath = launcherPath();
assert.ok(path.isAbsolute(defaultPath));
assert.ok(defaultPath.endsWith(path.join('bin', LAUNCHER_BIN)), defaultPath);

// --- probe: a missing launcher is unusable, indistinguishable from an unenforcing kernel ---
assert.equal(probe(path.join(os.tmpdir(), 'nalr-no-such-launcher')), 'unusable');

// --- probe: verdict parsing over fake launchers (POSIX shells only) ---
if (process.platform !== 'win32') {
  // 存放多个可执行假启动器的临时目录。
  const fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nalr-fake-launcher-'));
  /**
   * 创建一个可执行的 Shell 假启动器。
   * @param {string} name 临时脚本文件名。
   * @param {string} script 脚本主体。
   * @returns {string} 新建假启动器的完整路径。
   * @example fake('full', 'echo "landlock: fully enforced"; exit 0');
   */
  const fake = (name, script) => {
    // 当前假启动器的目标路径。
    const file = path.join(fakeDir, name);
    fs.writeFileSync(file, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
    return file;
  };

  assert.equal(probe(fake('full', 'echo "landlock: fully enforced"; exit 0')), 'full');
  assert.equal(probe(fake('partial', 'echo "landlock: partially enforced (older ABI)"; exit 0')), 'partial');
  assert.equal(probe(fake('failing', `exit ${LAUNCHER_FAILURE_EXIT}`)), 'unusable');
  assert.equal(probe(fake('hanging', 'sleep 10'), { timeoutMs: 200 }), 'unusable');

  fs.rmSync(fakeDir, { recursive: true, force: true });
}

console.log('entry.test: ok');
