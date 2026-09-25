// @vitest-environment jsdom
/** 插件重复装卸只移除自有正文贡献，不销毁官方预览服务。 */
import { expect, it, vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { createDocumentPresentation } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/src/client/qs/presentation.ts'
import { DocumentPreviewRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/src/client/document/registry.ts'
import { apply, inject } from '../src/client/index.ts'
import { tabInfoFactory } from '../src/client/contract.ts'
import type { PreviewInjected } from '../src/client/Preview.tsx'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createPdfPresentation } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/src/client/qs/pdf-presentation.ts'

it('waits for parent declaration and releases the host, text body and locale on each unload', async () => {
  const runtime = await SlotTestRuntime.create()
  try {
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale', locale); runtime.slots.installLocale(locale)
    const registry = new DocumentPreviewRegistry()
    const shared = createDocumentPresentation({ workspaceFiles: { read: vi.fn() } }, vi.fn(), registry, vi.fn())
    runtime.ctx.provide('documentPreviewPresentation', shared)
    runtime.ctx.provide('documentPreviews', registry)
    const pdf = createPdfPresentation()
    runtime.ctx.provide('documentPdfPresentation', pdf.presentation)
    runtime.ctx.effect(() => pdf.dispose)
    for (let cycle = 0; cycle < 2; cycle++) {
      const fiber = await runtime.mount({ inject, apply })
      if (cycle === 0) {
        expect(runtime.slots.entries('qs.sidebar.right.tab')).toHaveLength(0)
        await runtime.declare({
          'qs.sidebar.right.tab': { kind: 'keyed', scope: 'session', inject: {
            hooks: { tabInfo: () => () => { throw new Error('Registration-only fixture') } },
          } },
        })
      }
      const entries = runtime.slots.entries('qs.sidebar.right.tab')
      expect(entries).toHaveLength(1)
      expect(entries[0]!.store).toBe(shared.store)
      expect(runtime.slots.entries('qs.sidebar.document')).toHaveLength(6)
      const bind = entries[0]!.inject
      if (typeof bind !== 'function') throw new Error('Missing document injection')
      const instance = shared.store.create()
      // registry 抹除了参数类型，此处按实际注册的 session/store 注入声明恢复类型。
      const typedBind = bind as unknown as (...args: Parameters<typeof shared.inject>) => PreviewInjected
      const injected = typedBind('test' as SessionId, instance.actions)
      expect(injected.candidates('sample.txt')).toEqual([])
      expect(injected.hooks.documentPreviews.getSnapshot()).toEqual([])
      const html = runtime.slots.entries('qs.sidebar.document').find(entry => entry.options.key?.endsWith('/html'))
      if (typeof html?.inject !== 'function') throw new Error('Missing HTML injection')
      expect(html.inject()).toEqual({ prepareHtml: shared.prepareHtml })
      const pdfEntry = runtime.slots.entries('qs.sidebar.document').find(entry => entry.options.key?.endsWith('/pdf'))
      if (typeof pdfEntry?.inject !== 'function') throw new Error('Missing PDF injection')
      const bindPdf = pdfEntry.inject as unknown as typeof pdf.presentation.inject
      const pdfInstance = pdf.presentation.store.create()
      expect(pdfEntry.store).toBe(pdf.presentation.store)
      expect(bindPdf('test' as SessionId, pdfInstance.actions)).toEqual({
        ...pdf.presentation.inject('test' as SessionId, pdfInstance.actions), open: pdf.presentation.open, render: pdf.presentation.render,
      })
      await fiber.dispose()
      expect(runtime.slots.entries('qs.sidebar.right.tab')).toHaveLength(0)
      expect(runtime.slots.entries('qs.sidebar.document')).toHaveLength(0)
      expect(runtime.ctx.documentPreviewPresentation).toBe(shared)
    }
    const hook = () => { throw new Error('Not rendered') }
    expect(tabInfoFactory({} as Parameters<typeof tabInfoFactory>[0], hook)).toBe(hook)
  } finally { await runtime.dispose() }
})
