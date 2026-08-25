// @vitest-environment jsdom
// 本测试在 jsdom 中通过真实构建客户端图验证命令图片封装。
// The command image-attachment envelope over the BUILT client graph (real
// bundles via AppWebEntry, keyless FixtureApiClient transport): an enter
// submission carrying composer images resolves only through a command whose
// descriptor declares `input.images`. A non-declaring command refuses with
// one composer error banner and everything retained; a declaring command
// consumes the images — serialized through the real draft-image chain into
// the commands/execute payload — and clears the composer on success, including
// when the image is the whole `/plan` task.
// 声明支持图片的命令会消费真实草稿图片载荷并在成功后清空编辑器，包括只有图片的 /plan。
/**
 * 文件职责：验证命令提交对图片附件能力声明的拒绝、传递和成功清理行为。
 * 技术维度：使用 Testing Library、Clipboard File、真实构建客户端装配和 Fixture 命令执行器。
 * 产品维度：图片不会误传给不支持的命令；支持图片的目标或计划命令可可靠接收附件。
 * 逻辑维度：创建新会话并粘贴 PNG，分别提交 /echo、/goal 和纯 /plan，检查提示与草稿状态。
 * 关键边界：拒绝时必须同时保留文本与图片；成功时两者都清空，错误只出现在 alert 区域。
 * 新手阅读建议：先看 freshComposer 与 pasteImage，再比较三个用例提交后的附件轨道变化。
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'
import { installAssembledBootEnv, mountAssembledApp } from './assembled-boot.ts'

installAssembledBootEnv()

/** Open a fresh fixture session and return its composer textarea. */
/* 打开新的 fixture 会话并返回编辑器 textarea。 */
async function freshComposer(): Promise<HTMLTextAreaElement> {
  /** 已装配应用的会话树。 */
  const tree = await screen.findByRole('tree', { name: 'Sessions' }, { timeout: 10_000 })
  /** fixture 工作区的新建会话按钮。 */
  const start = tree.querySelector<HTMLButtonElement>('button[aria-label="New session in fixture"]')
  if (start === null) throw new Error('fixture Workspace new-session action missing')
  fireEvent.click(start)
  return await screen.findByPlaceholderText('Describe what you want to build', {}, { timeout: 10_000 }) as HTMLTextAreaElement
}

/** Paste one tiny PNG into the composer and wait for its rail thumbnail. */
/* 向编辑器粘贴最小 PNG，并在附件缩略图出现后完成。 */
async function pasteImage(textarea: HTMLTextAreaElement, name: string): Promise<void> {
  /** 模拟剪贴板图片的最小 PNG 文件。 */
  const image = new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' })
  fireEvent.paste(textarea, {
    clipboardData: {
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => image }],
      getData: () => '',
    },
  })
  await waitFor(() => {
    /** 编辑器待提交图片的附件轨道。 */
    const rail = document.querySelector('[role="group"][aria-label="Pending images"]')
    if (rail === null) throw new Error('attachment rail missing')
    expect([...rail.querySelectorAll('img')].map(img => img.getAttribute('alt'))).toContain(name)
  }, { timeout: 5_000 })
}

it('refuses an image-carrying submit to a non-declaring command and keeps draft and images', async () => {
  mountAssembledApp()
  /** 当前新会话的编辑器。 */
  const textarea = await freshComposer()
  await pasteImage(textarea, 'ref.png')

  // /echo is a leadingInput fixture command without `input.images`.
  // /echo 是未声明 input.images 的 leadingInput 夹具命令。
  fireEvent.change(textarea, { target: { value: '/echo hello' } })
  fireEvent.keyDown(textarea, { key: 'Enter' })

  // The refusal rides the same transient error banner as other composer
  // failures; session activity remains on its separate status live region.
  // 拒绝使用普通编辑器错误横幅，会话活动继续使用独立 status live region。
  /** 显示不支持图片诊断的编辑器错误横幅。 */
  const notice = await waitFor(() => {
    /** 包含图片附件诊断的 alert 元素。 */
    const el = [...document.querySelectorAll('[role="alert"]')]
      .find(candidate => candidate.textContent?.includes('image attachments') ?? false)
    if (el === undefined) throw new Error('composer refusal banner missing')
    return el
  }, { timeout: 5_000 })
  expect(notice.textContent).toBe('/echo does not accept image attachments; remove them first')
  expect([...document.querySelectorAll('[role="status"]')]
    .some(candidate => candidate.textContent?.includes('image attachments') ?? false)).toBe(false)
  // The whole envelope is retained: draft text and the rail thumbnail.
  // 整个提交封装都保留，包括草稿文本和附件缩略图。
  expect(textarea.value).toBe('/echo hello')
  /** 拒绝后仍存在的附件轨道。 */
  const rail = document.querySelector('[role="group"][aria-label="Pending images"]')
  expect([...(rail?.querySelectorAll('img') ?? [])].map(img => img.getAttribute('alt'))).toEqual(['ref.png'])
})

it('consumes images through a declaring command and clears the composer on success', async () => {
  mountAssembledApp()
  /** 当前新会话的编辑器。 */
  const textarea = await freshComposer()
  await pasteImage(textarea, 'goal-ref.png')

  // /goal declares `input.images` in the fixture catalog; the claim submit
  // serializes the pasted bytes and the fixture executor admits them.
  // /goal 声明 input.images，提交会序列化图片字节并由夹具执行器接收。
  fireEvent.change(textarea, { target: { value: '/goal rebuild the cathedral' } })
  fireEvent.keyDown(textarea, { key: 'Enter' })

  await waitFor(() => {
    expect(textarea.value).toBe('')
    expect(document.querySelector('[role="group"][aria-label="Pending images"]')).toBeNull()
  }, { timeout: 5_000 })
})

it('submits a bare /plan with an image as an image-only plan request', async () => {
  mountAssembledApp()
  /** 当前新会话的编辑器。 */
  const textarea = await freshComposer()
  await pasteImage(textarea, 'plan-task.png')

  fireEvent.change(textarea, { target: { value: '/plan' } })
  fireEvent.keyDown(textarea, { key: 'Enter' })

  await waitFor(() => {
    expect(textarea.value).toBe('')
    expect(document.querySelector('[role="group"][aria-label="Pending images"]')).toBeNull()
  }, { timeout: 5_000 })
  expect([...document.querySelectorAll('[role="alert"]')]
    .some(candidate => candidate.textContent?.includes('/plan') ?? false)).toBe(false)
})
