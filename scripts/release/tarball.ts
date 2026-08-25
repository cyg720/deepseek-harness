/**
 * Reading packed npm tarballs and the order file that accompanies them.
 *
 * The release steps after pack treat a directory of tarballs as the unit of
 * work, so they read what a tarball declares rather than what the checkout
 * currently says.
 */
/*
 * 中文说明：
 * - 文件职责：读取 npm 打包产物的文件列表、包身份和同批发布顺序。
 * - 技术维度：调用系统 tar 命令、解析 JSON、同步读取文本并使用 TypeScript 运行时收窄。
 * - 产品维度：让发布流程以实际 tarball 内容为准，避免工作区状态与待上传产物不一致。
 * - 逻辑维度：提供列成员、提取 package.json、读取顺序文件三个独立工具函数。
 * - 关键边界：要求系统存在 tar；路径应为绝对路径；包清单缺少字符串 name/version 时立即失败。
 * - 新手阅读建议：先看 capture 如何执行命令，再依次理解三个函数各自返回的发布信息。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { capture } from './process.ts'

/** Name of the file recording the order in which a packed family uploads. */
/* 中文：记录同一打包家族上传顺序的固定文件名，内容每行一个 tarball 文件名。 */
export const PUBLISH_ORDER_FILE = 'publish-order.txt'

/** What a packed tarball calls itself. */
/* 中文：从 tarball 内部 package.json 读取的包名与版本。 */
export interface PackedIdentity {
  /** Package name from the packed manifest. */
  /* 中文：打包清单声明的 npm 包名。 */
  readonly name: string
  /** Package version from the packed manifest. */
  /* 中文：打包清单声明的版本字符串。 */
  readonly version: string
}

/**
 * List a tarball's members.
 * @param tarball - absolute tarball path.
 * @returns Every path inside the archive.
 */
/* 中文：列出 tarball 内全部路径；参数为绝对路径，返回非空成员路径数组。示例：tarballFiles('/tmp/a.tgz')。 */
export function tarballFiles(tarball: string): string[] {
  return capture('tar', ['-tzf', tarball]).split('\n').filter(line => line !== '')
}

/**
 * Read a packed tarball's own manifest.
 * @param tarball - absolute tarball path.
 * @returns The name and version the tarball declares.
 */
/* 中文：读取 tarball 自带清单中的包名和版本；字段无效时抛错。示例：packedIdentity('/tmp/a.tgz')。 */
export function packedIdentity(tarball: string): PackedIdentity {
  /** 从归档标准输出解析出的未知清单值，需先做对象与字段检查。 */
  const manifest: unknown = JSON.parse(capture('tar', ['-xOzf', tarball, 'package/package.json']))
  if (manifest === null || typeof manifest !== 'object') throw new Error(`${tarball} has no manifest`)
  /** 清单中的候选 name 和 version，在运行时确认二者均为字符串。 */
  const { name, version } = manifest as Record<string, unknown>
  if (typeof name !== 'string' || typeof version !== 'string') throw new Error(`${tarball} manifest lacks name/version`)
  return { name, version }
}

/**
 * Read a packed directory's upload order.
 * @param directory - absolute path of a pack output directory.
 * @returns Tarball filenames in upload order.
 */
/* 中文：读取 directory 下的发布顺序文件；返回过滤空行后的 tarball 文件名。示例：readPublishOrder('/tmp/packed')。 */
export function readPublishOrder(directory: string): string[] {
  return readFileSync(join(directory, PUBLISH_ORDER_FILE), 'utf8').split('\n').filter(line => line !== '')
}
