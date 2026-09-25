/** Windows 声明换行不能令生成模块产生未闭合字符串。 */
import { expect, it } from 'vitest'
import ts from 'typescript'
import { renderClientCatalog } from '../gen-client-catalog.ts'
it('CRLF 与 LF 生成相同且可编译的字符串', () => {
  const entry = {
    key: 'qs.example', kind: 'single', scope: 'root', summary: 'summary', doc: 'first\r\nsecond',
    registerOptions: [], ownerProps: ['interface Owner {\r\n value: string\r\n}'], ownerPropsReferences: [],
    standardProps: [], keyDomain: '', hookContext: '', slotInject: '', declaredBy: '', occupants: [], replaceRisk: '', example: '', source: '',
  }
  const text = renderClientCatalog([entry])
  expect(text).toBe(renderClientCatalog([{ ...entry, doc: entry.doc.replaceAll('\r', ''), ownerProps: entry.ownerProps.map(value => value.replaceAll('\r', '')) }]))
  const output = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.ESNext }, reportDiagnostics: true })
  expect(output.diagnostics).toEqual([])
})
