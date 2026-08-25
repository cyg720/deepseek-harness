/**
 * Behavioral tests against the REAL launcher binary on a real kernel: the
 * CLI contract (usage errors, exit codes, argv passthrough) and the
 * confinement world-proofs (denied writes stay off disk, grants land).
 *
 * Preconditions and their skip semantics:
 * - Non-Linux host: skips entirely (exit 0) — there is nothing to build here.
 * - Linux without the built binary: FAILS — run `pnpm build:native` first.
 * - Linux whose kernel does not enforce Landlock: skips the enforcement
 *   half, unless `NALR_REQUIRE_LANDLOCK=1` (set on CI, where a silent skip on
 *   the very platform that exists to prove enforcement would be a false
 *   green).
 */
/*
 * 文件职责：在真实 Linux 内核与启动器二进制上验证 Landlock CLI、退出码传递和文件隔离行为。
 * 技术维度：使用 Node.js assert、同步子进程和临时目录执行端到端系统级验证。
 * 产品维度：证明发布的启动器既能运行正常命令，也能阻止未授权写入并允许明确授权路径。
 * 逻辑维度：先处理平台前置条件，再测参数错误和探针，随后测受限执行、隔离继承以及失败关闭。
 * 关键边界：仅 Linux 执行；缺二进制直接失败；内核不支持时可跳过隔离部分，但 CI 可要求必须支持。
 * 新手阅读建议：先理解 probe 的 full/partial/unusable 三态，再对照 grantArgs 观察允许和拒绝写入的差异。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  LAUNCHER_FAILURE_EXIT,
  grantArgs,
  launcherPath,
  probe,
} from '@deepseek-ai/node-addon-landlock-run';

// 所有启动器自身致命错误必须带有的固定前缀。
const FATAL_PREFIX = 'landlock-run: ';
// 旧内核只能部分执行规则时应写入 stderr 的固定提示。
const PARTIAL_NOTICE = 'landlock-run: partial enforcement (older Landlock ABI)';
// CI 可通过环境变量要求探针必须确认 Landlock 可用。
const requireLandlock = process.env.NALR_REQUIRE_LANDLOCK === '1';

if (process.platform !== 'linux') {
  console.log(`launcher.test: SKIP — the launcher only exists on linux (host: ${process.platform})`);
  process.exit(0);
}

// 当前平台包解析得到的真实启动器二进制路径。
const launcher = launcherPath();
assert.ok(
  fs.existsSync(launcher),
  `launcher.test: no built launcher at ${launcher} — run \`pnpm build:native\` (apt-get install musl-tools) first`,
);

/**
 * 同步执行真实启动器并捕获文本输出。
 * @param {string[]} args 启动器参数。
 * @param {import('node:child_process').SpawnSyncOptionsWithStringEncoding} options 可覆盖的子进程选项。
 * @returns {import('node:child_process').SpawnSyncReturns<string>} 执行状态及输出。
 * @example run(['--probe']);
 */
const run = (args, options = {}) => spawnSync(launcher, args, { encoding: 'utf8', ...options });

// --- usage errors: parse failures exit LAUNCHER_FAILURE_EXIT before any restriction ---
{
  // 缺少被包装命令时的执行结果。
  const noCommand = run([]);
  assert.equal(noCommand.status, LAUNCHER_FAILURE_EXIT);
  assert.ok(noCommand.stderr.startsWith(FATAL_PREFIX));
  assert.match(noCommand.stderr, /usage error: missing `-- <argv>\.\.\.` command/);

  // 使用未知参数时的执行结果。
  const unknownFlag = run(['--bogus', '--', 'true']);
  assert.equal(unknownFlag.status, LAUNCHER_FAILURE_EXIT);
  assert.match(unknownFlag.stderr, /usage error: unknown argument: --bogus/);

  // --ro 后缺少路径时的执行结果。
  const danglingPath = run(['--ro']);
  assert.equal(danglingPath.status, LAUNCHER_FAILURE_EXIT);
  assert.match(danglingPath.stderr, /--ro requires a path/);

  for (const args of [
    ['--probe', '--ro', '/'],
    ['--probe', '--'],
    ['--probe', '--probe'],
  ]) {
    // probe 混入额外参数时的执行结果。
    const probeWithExtras = run(args);
    assert.equal(probeWithExtras.status, LAUNCHER_FAILURE_EXIT);
    assert.match(probeWithExtras.stderr, /--probe takes no other arguments/);
  }
}

// --- probe: the functional availability signal ---
// 当前内核对 Landlock 的实际支持状态。
const enforcement = probe(launcher);
console.log(`launcher.test: probe → ${enforcement}`);
if (enforcement === 'unusable') {
  if (requireLandlock) {
    console.error('launcher.test: NALR_REQUIRE_LANDLOCK=1 but the probe reports unusable — this kernel cannot prove enforcement');
    process.exit(1);
  }
  console.log('launcher.test: SKIP enforcement half — kernel does not enforce Landlock');
  process.exit(0);
}
// 后续成功命令在部分隔离模式下预期出现的 stderr 内容。
const expectedNotice = enforcement === 'partial' ? `${PARTIAL_NOTICE}\n` : '';
{
  // 直接调用 --probe 时的原始 CLI 输出。
  const probeRun = run(['--probe']);
  assert.equal(probeRun.status, 0);
  assert.match(probeRun.stdout, /^landlock: (fully enforced|partially enforced \(older ABI\))\n$/);
}

// --- confined exec: the command runs, its exit code passes through ---
{
  // 在只读根目录规则下执行 echo 的结果。
  const echo = run([...grantArgs({ readOnly: ['/'] }), '--', '/bin/sh', '-c', 'echo confined-ok']);
  assert.equal(echo.status, 0, echo.stderr);
  assert.equal(echo.stdout, 'confined-ok\n');
  assert.equal(echo.stderr, expectedNotice);

  // 用于验证子命令退出码7原样传递的结果。
  const exitCode = run([...grantArgs({ readOnly: ['/'] }), '--', '/bin/sh', '-c', 'exit 7']);
  assert.equal(exitCode.status, 7, 'the wrapped command exit code must pass through unchanged');

  // 子命令主动返回125时的结果，允许与启动器失败码相同。
  const child125 = run([...grantArgs({ readOnly: ['/'] }), '--', '/bin/sh', '-c', `exit ${LAUNCHER_FAILURE_EXIT}`]);
  assert.equal(child125.status, LAUNCHER_FAILURE_EXIT, 'a wrapped child may itself return the launcher failure status');
  assert.equal(child125.stderr, expectedNotice);
}

// --- world-proofs: denied writes stay off disk, grants land, inheritance crosses exec ---
{
  // 世界证明使用的独立临时工作目录。
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'nalr-launcher-test-'));

  // 未授权写入的目标文件，执行后必须仍不存在。
  const denied = path.join(work, 'denied.txt');
  // 只授予根目录只读权限时尝试写入的结果。
  const deniedRun = run([...grantArgs({ readOnly: ['/'] }), '--', '/bin/sh', '-c', `echo x > ${denied}`]);
  assert.notEqual(deniedRun.status, 0, 'a write outside the grants must fail');
  assert.ok(!fs.existsSync(denied), 'the denied write must not land on disk');

  // 明确授权可写目录内的目标文件。
  const granted = path.join(work, 'granted.txt');
  // 同时授予根只读和工作目录可写权限后的执行结果。
  const grantedRun = run([...grantArgs({ readOnly: ['/'], readWrite: [work] }), '--', '/bin/sh', '-c', `echo ok > ${granted}`]);
  assert.equal(grantedRun.status, 0, grantedRun.stderr);
  assert.equal(fs.readFileSync(granted, 'utf8'), 'ok\n');

  // The ruleset is inherited across execve: a CHILD of the wrapped command
  // is confined too, not just the direct exec target.
  // 嵌套子进程尝试写入的目标文件，用于证明规则跨 execve 继承。
  const nested = path.join(work, 'nested.txt');
  // 外层 Shell 启动内层 Shell 后尝试未授权写入的结果。
  const nestedRun = run([...grantArgs({ readOnly: ['/'] }), '--', '/bin/sh', '-c', `/bin/sh -c 'echo x > ${nested}'; true`]);
  assert.equal(nestedRun.status, 0, nestedRun.stderr);
  assert.ok(!fs.existsSync(nested), 'a denied write from a nested child must not land either');

  fs.rmSync(work, { recursive: true, force: true });
}

// --- fail closed: an unopenable grant root refuses to exec at all ---
{
  // 启动器失败时被包装命令绝不能创建的标记文件。
  const marker = path.join(os.tmpdir(), `nalr-should-not-exist-${process.pid}`);
  // 指定不存在授权根目录时的失败执行结果。
  const badGrant = run(['--ro', '/no/such/grant/root', '--', '/bin/sh', '-c', `echo x > ${marker}`]);
  assert.equal(badGrant.status, LAUNCHER_FAILURE_EXIT);
  assert.ok(badGrant.stderr.startsWith(FATAL_PREFIX));
  assert.match(badGrant.stderr, /cannot open rule path/);
  assert.ok(!fs.existsSync(marker), 'the command must never run when the launcher fails');
}

console.log('launcher.test: ok');
