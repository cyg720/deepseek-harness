import { expect, it } from 'vitest'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { resolveScriptedEntry, type ReplayEntry } from '../../src/index.ts'

it('escapes captured paths in tool argument deltas and blocks while preserving text', () => {
  const path = 'C:\\workspace\\a"b\tfile.svg'
  const token = '{{fromRequest:<path>([^<]+)</path>}}'
  const args = `{"file_path":"${token}"}`
  const entry: ReplayEntry = { kind: 'chunks', chunks: [
    { type: 'tool-call-delta', index: 0, id: ToolCallId('write'), argumentsDelta: args },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId('write'), name: 'write', arguments: args } },
    { type: 'text-delta', index: 1, text: token },
  ] }
  const result = resolveScriptedEntry(entry, [createUserMessage({
    content: [{ type: 'text', text: `<path>${path}</path>` }], source: { kind: 'user' },
  })])
  expect(result).toMatchObject({ chunks: [
    { argumentsDelta: JSON.stringify({ file_path: path }) },
    { block: { arguments: JSON.stringify({ file_path: path }) } },
    { text: path },
  ] })
})
