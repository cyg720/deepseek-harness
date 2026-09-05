// @vitest-environment jsdom
// Multimodal image surfaces over the BUILT client graph (the ptc-fixture
// idiom: real bundles via AppWebEntry, keyless fixture Connection RPC).
// Opens the fixture history session whose turn 73 carries an image in BOTH a
// user message and an assistant message, and pins the product surfaces: the
// history ImageGallery loading real fixture bytes through the authorized
// sessions.attachment route, the single-click ImageLightbox, and the composer
// intake chain (paste → ordered thumbnail rail → image-only send enablement → remove).
// 中文说明：该组装测试覆盖图片历史、灯箱、粘贴、拖放、限制提示和删除链路。
/**
 * 文件职责：验证已构建客户端中的图片历史展示、灯箱预览和编辑器附件接收流程。
 * 技术维度：使用 Vitest、jsdom 与 Testing Library 驱动真实组装客户端，并对 DOM 做快照断言。
 * 产品维度：保障用户能查看会话图片、添加或移除待发送图片，并收到清晰的限制提示。
 * 逻辑维度：打开固定历史会话，再依次验证展示、粘贴、整页拖放、数量限制和主机拒绝反馈。
 * 关键边界：依赖已构建客户端、固定 fixture 和 jsdom 对象 URL；不会调用真实模型。
 * 新手阅读建议：先读 openFixtureSession，再按测试顺序观察图片从历史到编辑器及错误提示的变化。
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import { installAssembledBootEnv, mountAssembledApp } from './assembled-boot.ts'

installAssembledBootEnv()

/** Open the fixture history session (the alpha log carrying the turn-72 image pair) and wait for its gallery. */
/* 打开带有成对图片的固定历史会话并等待图片列表完成渲染。 */
async function openFixtureSession(): Promise<void> {
  /** 会话侧栏的无障碍树根节点。 */
  const tree = await screen.findByRole('tree', { name: 'Sessions' }, { timeout: 10_000 })
  /** fixture 工作区对应的可展开树项。 */
  const group = (await within(tree).findAllByText('fixture'))
    .map(el => el.closest<HTMLElement>('[role="treeitem"]'))
    .find(el => el?.getAttribute('aria-expanded') !== null)
  if (group === null || group === undefined) throw new Error('fixture Workspace group missing')
  if (group.getAttribute('aria-expanded') === 'false') {
    fireEvent.click(within(group).getByText('fixture'))
    await waitFor(() => {
      expect(group.getAttribute('aria-expanded')).toBe('true')
    })
  }
  /** 含有用户侧和助手侧图片的历史会话入口。 */
  const session = await within(tree).findByText('Fixture 历史会话')
  fireEvent.click(session)
  await waitFor(() => {
    expect(document.querySelectorAll('[data-align] img').length).toBeGreaterThan(0)
  }, { timeout: 10_000 })
}

it('renders the history image pair through the authorized attachment route and opens the lightbox', async () => {
  mountAssembledApp()
  await openFixtureSession()

  // Both the user-side (align=end) and assistant-side (align=start) galleries
  // load real fixture bytes over sessions.attachment. jsdom provides
  // createObjectURL, so this environment MUST take the object-URL path — a
  // data: src here would mean the fallback ran where it should not.
  // 中文说明：两侧图片必须经授权附件路由得到 blob 地址，data 地址表示错误地进入了降级路径。
  await waitFor(() => {
    if (document.querySelector('[data-align="end"] img') === null
      || document.querySelector('[data-align="start"] img') === null) {
      throw new Error('history image galleries missing')
    }
  }, { timeout: 10_000 })
  /** 按消息对齐方向提取图片替代文本和 URL 协议，返回可稳定比较的摘要。 */
  const galleryShape = (align: string) => [...document.querySelectorAll(`[data-align="${align}"] img`)]
    .map(img => ({ alt: img.getAttribute('alt'), scheme: img.getAttribute('src')?.split(':')[0] }))
  expect({ user: galleryShape('end'), assistant: galleryShape('start') }).toMatchInlineSnapshot(`
    {
      "assistant": [
        {
          "alt": "fixture-image.png",
          "scheme": "blob",
        },
      ],
      "user": [
        {
          "alt": "fixture-image.png",
          "scheme": "blob",
        },
      ],
    }
  `)
  /** 用户消息侧用于打开灯箱的首张图片。 */
  const userImage = document.querySelector<HTMLElement>('[data-align="end"] img')!

  // A single click opens the original-size lightbox; Escape/close dismisses it.
  // 中文说明：单击图片打开原尺寸灯箱，关闭按钮或 Escape 可退出。
  /** 包裹用户图片并承载打开动作的按钮。 */
  const frame = userImage.closest('button')
  if (frame === null) throw new Error('image frame button missing')
  fireEvent.click(frame)
  /** 单击图片后出现的灯箱对话框。 */
  const lightbox = await screen.findByRole('dialog')
  expect(within(lightbox).getByRole('img').getAttribute('src')?.split(':')[0]).toBe('blob')
  fireEvent.click(within(lightbox).getByRole('button', { name: /Close/ }))
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

it('accepts pasted images into the composer rail in order and removes them', async () => {
  mountAssembledApp()

  /** 用于创建新会话的侧栏树。 */
  const tree = await screen.findByRole('tree', { name: 'Sessions' }, { timeout: 10_000 })
  /** fixture 工作区的新建会话按钮。 */
  const start = tree.querySelector<HTMLButtonElement>('button[aria-label="New session in fixture"]')
  if (start === null) throw new Error('fixture Workspace new-session action missing')
  fireEvent.click(start)

  // Image-only send arming is pinned at package level (input-bar.spec.tsx);
  // this assembled lane pins the intake chain over the built graph.
  const textarea = await waitFor(() => {
    const surface = document.querySelector<HTMLElement>(
      '[data-composer-input][data-placeholder="Describe what you want to build... / commands, @ files or sessions"]',
    )
    if (surface === null) throw new Error('composer surface missing')
    return surface
  }, { timeout: 10_000 })
  const image = new File([new Uint8Array([137, 80, 78, 71])], 'pasted.png', { type: 'image/png' })
  fireEvent.paste(textarea, {
    clipboardData: {
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => image }],
      getData: () => '',
    },
  })

  // The rail is an accessible group holding the draft thumbnail (queried via
  // DOM: jsdom's a11y-visibility computation hides the composer subtree).
  // 中文说明：jsdom 会把编辑器子树判断为不可见，因此通过 DOM 直接定位附件栏。
  /** 显示待发送图片缩略图的附件栏。 */
  const rail = await waitFor(() => {
    const el = document.querySelector('[role="group"][aria-label="Pending attachments"]')
    if (el === null) throw new Error('attachment rail missing')
    return el
  }, { timeout: 5_000 })
  expect([...rail.querySelectorAll('img')].map(img => ({
    alt: img.getAttribute('alt'), scheme: img.getAttribute('src')?.split(':')[0],
  }))).toMatchInlineSnapshot(`
    [
      {
        "alt": "pasted.png",
        "scheme": "blob",
      },
    ]
  `)

  /** 用于验证附件顺序的第二张 PNG 文件。 */
  const second = new File([new Uint8Array([137, 80, 78, 71])], 'second.png', { type: 'image/png' })
  fireEvent.paste(textarea, {
    clipboardData: {
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => second }],
      getData: () => '',
    },
  })
  await waitFor(() => {
    expect([...rail.querySelectorAll('img')].map(img => img.getAttribute('alt')))
      .toEqual(['pasted.png', 'second.png'])
  })

  /** 当前附件栏中每张图片对应的删除按钮。 */
  const remove = [...rail.querySelectorAll('button[aria-label^="Remove image"]')]
  if (remove.length !== 2) throw new Error('remove buttons missing')
  for (const button of remove) fireEvent.click(button)
  await waitFor(() => {
    expect(document.querySelector('[role="group"][aria-label="Pending attachments"]')).toBeNull()
  })

  // A non-image paste follows the generic-file path and remains in the
  // composer as a file card.
  fireEvent.paste(textarea, {
    clipboardData: {
      items: [{ kind: 'file', type: 'text/plain', getAsFile: () => new File(['x'], 'notes.txt', { type: 'text/plain' }) }],
      getData: () => '',
    },
  })
  const files = await screen.findByRole('group', { name: 'Pending attachments' })
  expect(files.textContent).toContain('notes.txt')
})

it('accepts a whole-page drop under the limits-labeled overlay and refuses an over-limit batch at intake', async () => {
  mountAssembledApp()

  /** 用于进入新会话的侧栏树。 */
  const tree = await screen.findByRole('tree', { name: 'Sessions' }, { timeout: 10_000 })
  /** fixture 工作区的新建会话按钮。 */
  const start = tree.querySelector<HTMLButtonElement>('button[aria-label="New session in fixture"]')
  if (start === null) throw new Error('fixture Workspace new-session action missing')
  fireEvent.click(start)
  const textarea = await waitFor(() => {
    const surface = document.querySelector<HTMLElement>(
      '[data-composer-input][data-placeholder="Describe what you want to build... / commands, @ files or sessions"]',
    )
    if (surface === null) throw new Error('composer surface missing')
    return surface
  }, { timeout: 10_000 })

  // A file drag anywhere over the page raises the full-viewport overlay whose
  // desc line carries the projected limits — copy that can only render after
  // the imageLimits projection crossed the real fixture transport.
  // 中文说明：覆盖层中的限制文案证明图片限制已通过真实 fixture 传输投影到客户端。
  /** 模拟从页面任意位置拖入的 PNG 文件。 */
  const image = new File([new Uint8Array([137, 80, 78, 71])], 'dropped.png', { type: 'image/png' })
  /** 浏览器拖放事件使用的最小数据传输对象。 */
  const dataTransfer = { types: ['Files'], files: [image], dropEffect: 'none' }
  fireEvent.dragEnter(document.body, { dataTransfer })
  /** 文件进入页面时覆盖整个视口的拖放提示。 */
  const overlay = await screen.findByRole('status')
  expect(overlay.textContent).toContain('Drag files or images here to add them')
  await waitFor(() => {
    expect(overlay.textContent).toContain('Image limit: up to 20 images, 5MB each')
  })

  // Dropping on the transcript area (not the composer card) lands in the rail.
  // 中文说明：即使落点不在编辑器卡片中，整页拖放也应把图片加入附件栏。
  fireEvent.drop(document.body, { dataTransfer })
  await waitFor(() => {
    const rail = document.querySelector('[role="group"][aria-label="Pending attachments"]')
    if (rail === null) throw new Error('attachment rail missing after page drop')
    expect([...rail.querySelectorAll('img')].map(img => img.getAttribute('alt'))).toEqual(['dropped.png'])
  }, { timeout: 5_000 })
  expect(screen.queryByRole('status')).toBeNull()

  // An intake that would exceed the projected per-message count is refused as
  // a whole batch at add time: the banner names the limit and the rail keeps
  // only the previously accepted thumbnail — no submit-time rollback.
  // 中文说明：超限批次在接收阶段整体拒绝，先前已接收图片保持不变。
  /** 二十张新图片组成的超限输入批次。 */
  const batch = Array.from({ length: 20 }, (_, i) =>
    new File([new Uint8Array([137, 80, 78, 71])], `bulk-${String(i)}.png`, { type: 'image/png' }))
  fireEvent.paste(textarea, {
    clipboardData: {
      items: batch.map(file => ({ kind: 'file', type: 'image/png', getAsFile: () => file })),
      getData: () => '',
    },
  })
  /** 超过单条消息图片数量上限时的提示。 */
  const limitMessage = 'A message can include up to 20 images'
  /** 显示数量限制的警告横幅。 */
  const banner = await screen.findByText(limitMessage)
  expect(banner.closest('[role="alert"]')).not.toBeNull()
  const rail = document.querySelector('[role="group"][aria-label="Pending attachments"]')
  expect([...(rail?.querySelectorAll('img') ?? [])]).toHaveLength(1)
})

it('renders a host dimension rejection with the projected 2000px limit', async () => {
  mountAssembledApp('?fixture&fixturePrompt=reject')

  /** 用于创建尺寸拒绝场景会话的侧栏树。 */
  const tree = await screen.findByRole('tree', { name: 'Sessions' }, { timeout: 10_000 })
  /** fixture 工作区的新建会话按钮。 */
  const start = tree.querySelector<HTMLButtonElement>('button[aria-label="New session in fixture"]')
  if (start === null) throw new Error('fixture Workspace new-session action missing')
  fireEvent.click(start)

  const textarea = await waitFor(() => {
    const surface = document.querySelector<HTMLElement>(
      '[data-composer-input][data-placeholder="Describe what you want to build... / commands, @ files or sessions"]',
    )
    if (surface === null) throw new Error('composer surface missing')
    return surface
  }, { timeout: 10_000 })
  const image = new File([new Uint8Array([137, 80, 78, 71])], 'too-wide.png', { type: 'image/png' })
  fireEvent.paste(textarea, {
    clipboardData: {
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => image }],
      getData: () => '',
    },
  })
  await waitFor(() => {
    expect(document.querySelector('[role="group"][aria-label="Pending attachments"]')).not.toBeNull()
  })
  fireEvent.keyDown(textarea, { key: 'Enter' })

  /** 主机拒绝超宽图片时应显示的具体修复建议。 */
  const message = 'Image sides must be at most 2000px; downscale it and try again'
  /** 承载尺寸错误的警告提示。 */
  const toast = await screen.findByText(message)
  expect({ role: toast.closest('[role="alert"]')?.getAttribute('role'), text: toast.textContent }).toMatchInlineSnapshot(`
    {
      "role": "alert",
      "text": "Image sides must be at most 2000px; downscale it and try again",
    }
  `)
  expect(document.querySelector('[role="group"][aria-label="Pending attachments"]')).not.toBeNull()
})
