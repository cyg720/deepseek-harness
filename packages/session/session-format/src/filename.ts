/** Canonical raw log basename shared by every generation-addressed Session artifact. */

/*
 * 【文件职责】生成不可变会话代次的规范 JSONL 文件名；
 * v0 使用原始名称，后续版本带小写数字 vN 后缀。
 */

import { sessionFormatVersion } from './json.ts'

const CANONICAL_LOG_FILENAME = /^session(?:\.v([1-9][0-9]*))?\.jsonl$/u

/**
 * Name the raw JSONL log of one immutable Session format generation. Version
 * zero keeps the original `session.jsonl`; every later generation carries a
 * lowercase numeric `.vN` component before the `.jsonl` suffix.
 * @param version - non-negative safe integer Session format version.
 * @returns the canonical basename, without any compression suffix.
 */
export function sessionFormatLogFilename(version: number): string {
  const generation = sessionFormatVersion(version, 'Session log generation version')
  return generation === 0 ? 'session.jsonl' : `session.v${generation}.jsonl`
}

/**
 * Read the generation named by one raw JSONL log basename. Temporary,
 * uppercase, leading-zero, `.v0`, and compression-suffixed names are not
 * canonical.
 * @param filename - one basename from a Session directory or archive.
 * @returns its Session format version, or `undefined` when the name is not canonical.
 */
export function parseSessionFormatLogFilename(filename: string): number | undefined {
  const match = CANONICAL_LOG_FILENAME.exec(filename)
  if (match === null) return undefined
  if (match[1] === undefined) return 0
  const version = Number(match[1])
  return Number.isSafeInteger(version) ? version : undefined
}
