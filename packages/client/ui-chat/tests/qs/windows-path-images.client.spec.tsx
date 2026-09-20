// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { AssistantMarkdown, localPathMediaUrl } from '../../src/client/chat/AssistantMarkdown.tsx'
import type { ChatNodeOwnerProps } from '../../src/client/contract/slots.ts'

afterEach(cleanup)

it.each(['C:\\workspace\\image.png', 'D:/workspace/image.png'])('loads the local image %s through the file API', (path) => {
  const origin = window.location.origin
  expect(localPathMediaUrl('http:', origin, path)).toBe(`${origin}/api/file?path=${encodeURIComponent(path)}`)
  const { container } = render(<AssistantMarkdown
    blocks={[{ kind: 'text', text: `![diagram](${path})` }]}
    streaming={false}
    renderMessageImages={(() => null) as ChatNodeOwnerProps['renderMessageImages']}
    t={(_key: string) => 'label'}
  />)
  const image = container.querySelector('img')
  expect(image).not.toBeNull()
  expect(new URL(image!.src).searchParams.get('path')).toBe(path)
})
