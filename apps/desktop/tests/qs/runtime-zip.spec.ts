/** 使用真实 ZIP 条目验证 Node 分发包解压限制；不依赖系统允许创建符号链接。 */
import { mkdtemp, mkdir, writeFile, readFile, lstat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { extractRuntimeZip } from '../../scripts/qs/extract-runtime-zip.ts'

// Python 标准库 zipfile 生成的最小 ZIP：普通文件、Unix 链接、链接后接同名普通文件。
// 固定名称及内容完全合成；链接目标始终落在本测试的私有根目录内。
const fixtures = {
  regular: 'UEsDBBQAAAAAAAAAIQDvVk2tDgAAAA4AAAANAAAAbm9kZS9ub2RlLmV4ZVNZTlRIRVRJQ19OT0RFUEsBAhQDFAAAAAAAAAAhAO9WTa0OAAAADgAAAA0AAAAAAAAAAAAAAKSBAAAAAG5vZGUvbm9kZS5leGVQSwUGAAAAAAEAAQA7AAAAOQAAAAAA',
  symlink: 'UEsDBBQAAAAAAAAAIQAFr4RLEQAAABEAAAANAAAAbm9kZS9ub2RlLmV4ZS4uLy4uL291dHNpZGUudHh0UEsBAhQDFAAAAAAAAAAhAAWvhEsRAAAAEQAAAA0AAAAAAAAAAAAAAP+hAAAAAG5vZGUvbm9kZS5leGVQSwUGAAAAAAEAAQA7AAAAPAAAAAAA',
  duplicate: 'UEsDBBQAAAAAAAAAIQAFr4RLEQAAABEAAAANAAAAbm9kZS9ub2RlLmV4ZS4uLy4uL291dHNpZGUudHh0UEsDBBQAAAAAAAAAIQC7/lRYCAAAAAgAAAANAAAAbm9kZS9ub2RlLmV4ZVJFUExBQ0VEUEsBAhQDFAAAAAAAAAAhAAWvhEsRAAAAEQAAAA0AAAAAAAAAAAAAAP+hAAAAAG5vZGUvbm9kZS5leGVQSwECFAMUAAAAAAAAACEAu/5UWAgAAAAIAAAADQAAAAAAAAAAAAAApIE8AAAAbm9kZS9ub2RlLmV4ZVBLBQYAAAAAAgACAHYAAABvAAAAAAA=',
} as const

for (const kind of ['regular', 'symlink', 'duplicate'] as const) {
  it(`extracts only permitted runtime entries: ${kind}`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'qs-runtime-zip-'))
    try {
      const archive = join(root, 'runtime.zip')
      const output = join(root, 'output')
      const outside = join(root, 'outside.txt')
      await mkdir(output)
      await writeFile(outside, 'UNCHANGED')
      await writeFile(archive, Buffer.from(fixtures[kind], 'base64'))
      if (kind === 'regular') {
        await extractRuntimeZip(archive, output)
        expect(await readFile(join(output, 'node/node.exe'), 'utf8')).toBe('SYNTHETIC_NODE')
      } else {
        await expect(extractRuntimeZip(archive, output)).rejects.toThrow('ZIP symbolic links are forbidden')
        await expect(lstat(join(output, 'node/node.exe'))).rejects.toMatchObject({ code: 'ENOENT' })
      }
      expect(await readFile(outside, 'utf8')).toBe('UNCHANGED')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
}
