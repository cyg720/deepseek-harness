/** Client 使用公开 Host 声明入口时仍验证导出，不访问不存在的 source symbol。 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import ts from 'typescript'
import { expect, it } from 'vitest'
import { WorkspaceAnalyzer } from '../../src/analyzer.ts'

it('跨面声明按公开导出映射解析，缺失导出仍然拒绝', () => {
  const root = mkdtempSync(join(import.meta.dirname, '.cross-face-'))
  try {
    cpSync(resolve(import.meta.dirname, '../fixtures/type-model'), root, { recursive: true })
    const base = JSON.parse(readFileSync(join(root, 'tsconfig.base.json'), 'utf8')) as { compilerOptions: { paths: Record<string, string[]> } }
    mkdirSync(join(root, 'packages/host/lib/types'), { recursive: true })
    for (const name of ['index', 'models']) {
      const input = readFileSync(join(root, `packages/host/src/${name}.ts`), 'utf8')
      writeFileSync(join(root, `packages/host/lib/types/${name}.d.ts`), ts.transpileDeclaration(input, { compilerOptions: { target: ts.ScriptTarget.ESNext }, fileName: `${name}.ts` }).outputText)
    }
    const clientPath = join(root, 'packages/client/tsconfig.json')
    const client = JSON.parse(readFileSync(clientPath, 'utf8')) as { compilerOptions: { paths: Record<string, string[]> } }
    client.compilerOptions.paths = { ...base.compilerOptions.paths, '@fixture/host': ['./packages/host/lib/types/index.d.ts'], '@fixture/host/*': ['./packages/host/lib/types/*'] }
    writeFileSync(clientPath, JSON.stringify(client))
    const model = new WorkspaceAnalyzer({ root }).analyze()
    expect(model.crossFaceLinks).toContainEqual(expect.objectContaining({ fromFace: 'client', toFace: 'host', toPackage: '@fixture/host' }))
    const source = join(root, 'packages/client/src/index.ts')
    writeFileSync(source, readFileSync(source, 'utf8').replace('HostAgent, Payload', 'MissingHostExport as HostAgent, Payload'))
    expect(() => new WorkspaceAnalyzer({ root }).analyze()).toThrow()
  } finally { rmSync(root, { recursive: true, force: true }) }
}, 60_000)
