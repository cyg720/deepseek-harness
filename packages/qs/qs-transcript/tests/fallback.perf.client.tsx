/** Manual component CPU diagnostic; compile to JavaScript before running with Node. */
import { performance } from 'node:perf_hooks'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { ROW_COMPONENTS, type QsRowProps } from '../src/client/rows.tsx'

const Row = ROW_COMPONENTS.unknown
if (Row === undefined) throw new Error('Unknown row presenter is not registered')
for (const [count, bytes] of [[20, 4096], [100, 131072]] as const) {
  let serializations = 0
  const nodes = Array.from({ length: count }, (_, index) => ({
    kind: 'synthetic-tool-result',
    visibility: 'visible',
    data: {
      index,
      output: 'synthetic-output-'.repeat(Math.ceil(bytes / 17)).slice(0, bytes),
      toJSON() { serializations++; return { index: this.index, output: this.output } },
    },
  }))
  const render = () => nodes.map((node, index) => renderToStaticMarkup(createElement(Row, {
    nodeKey: String(index),
    useNode: (_key, select) => select(node as unknown as ChatConversationViewNode),
    t: key => key,
  } as QsRowProps))).join('')
  render()
  const samples = []
  for (let sample = 0; sample < 5; sample++) {
    serializations = 0
    const start = performance.now()
    const html = render()
    const elapsedMs = performance.now() - start
    if (!html.includes('synthetic-tool-result')) throw new Error('Missing row summary')
    samples.push({ elapsedMs, serializations, outputBytes: Buffer.byteLength(html) })
  }
  console.log(JSON.stringify({ count, payloadBytesPerRow: bytes, samples }))
}
