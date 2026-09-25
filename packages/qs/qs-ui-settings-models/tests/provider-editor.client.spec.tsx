// @vitest-environment jsdom
/** 通过真实表单事件检查最小写入、部分成功重试和卸载后副作用隔离。 */
import { Context } from '@deepseek-ai/cordis'
import { SettingsSchemaService } from '@deepseek-ai/dsh-client-ui-settings/src/client/schema.ts'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ModelsOperations } from '@deepseek-ai/dsh-client-ui-settings-models/client'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { ProviderEditor, type ProviderEditorProps } from '../src/client/ProviderEditor.tsx'
import { Models } from '../src/client/Models.tsx'
import type { ModelsProps } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
function fixture() {
  const namespace: SettingsNamespaceView = { ns: 'llm-deepseek', schema: {}, revision: 2, applies: 'live', secrets: [],
    user: { baseURL: 'https://old.example', hidden: 'keep' },
    value: { baseURL: 'https://old.example', apiKeyEnv: 'KEY' } }
  const committed = { ...namespace, revision: 3, user: { baseURL: 'https://new.example', hidden: 'keep' },
    value: { baseURL: 'https://new.example', apiKeyEnv: 'KEY' } }
  const writeSettings = vi.fn<ModelsOperations['writeSettings']>().mockResolvedValue({ kind: 'written', view: committed })
  const storeCredential = vi.fn<ModelsOperations['storeCredential']>().mockResolvedValue(undefined)
  const discoverModels = vi.fn<ModelsOperations['discoverModels']>()
  const operations: ModelsOperations = { writeSettings, storeCredential, discoverModels,
    describeCredential: vi.fn(), removeCredential: vi.fn() }
  const onClose = vi.fn()
  const props: ProviderEditorProps = { namespace, operations, onClose, readOnly: false, t: key => zh[key],
    schema: new SettingsSchemaService(new Context()), row: {
      entry: { provider: 'deepseek', displayName: 'DeepSeek', settingsNs: namespace.ns, settingsPath: [], active: true },
      configured: true, removable: false, apiKeyEnv: 'KEY', credential: { configured: true, writable: true },
    } }
  return { props, committed, writeSettings, storeCredential, discoverModels, onClose }
}
function change(label: string, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }) }
function save() { fireEvent.click(screen.getByRole<HTMLButtonElement>('button', { name: zh.save })) }

it('配置提交只包含编辑字段，密钥失败保留确认版本，重试只写密钥', async () => {
  const f = fixture(); f.storeCredential.mockResolvedValueOnce('private secret failure')
  const node = render(<ProviderEditor {...f.props} />)
  expect((screen.getByLabelText<HTMLInputElement>(zh.apiKey)).value).toBe('')
  change(zh.endpoint, 'https://new.example'); change(zh.apiKey, '  fixture-key  '); save()
  await screen.findByText(zh.partialSave)
  expect(f.writeSettings).toHaveBeenCalledExactlyOnceWith('llm-deepseek', [{ op: 'set', path: ['baseURL'], value: 'https://new.example' }], 2)
  expect(f.storeCredential).toHaveBeenCalledExactlyOnceWith('KEY', 'fixture-key')
  expect(node.container.textContent).not.toContain('private secret')
  expect(f.onClose).not.toHaveBeenCalled()
  save(); await waitFor(() =>{  expect(f.onClose).toHaveBeenCalledWith(true) })
  expect(f.writeSettings).toHaveBeenCalledOnce(); expect(f.storeCredential).toHaveBeenCalledTimes(2)
  expect((screen.getByLabelText<HTMLInputElement>(zh.apiKey)).value).toBe('')
})

it.each(['conflict', 'refused'] as const)('配置 %s 保留字段且不写密钥', async (kind) => {
  const f = fixture(); f.writeSettings.mockResolvedValueOnce({ kind, message: 'private failure' })
  render(<ProviderEditor {...f.props} />)
  change(zh.endpoint, 'https://new.example'); change(zh.apiKey, 'fixture-key'); save()
  await screen.findByText(kind === 'conflict' ? zh.conflict : zh.saveFailed)
  expect((screen.getByLabelText<HTMLInputElement>(zh.apiKey)).value).toBe('fixture-key')
  expect(f.storeCredential).not.toHaveBeenCalled(); expect(f.onClose).not.toHaveBeenCalled()
})

it('配置在途关闭并卸载时，晚到确认不能再写凭据或通知新视图', async () => {
  const f = fixture(), gate = Promise.withResolvers<Awaited<ReturnType<ModelsOperations['writeSettings']>>>()
  f.writeSettings.mockReturnValueOnce(gate.promise)
  const node = render(<ProviderEditor {...f.props} />)
  change(zh.endpoint, 'https://new.example'); change(zh.apiKey, 'fixture-key'); save()
  await screen.findByRole('button', { name: zh.saving })
  fireEvent.click(screen.getByRole('button', { name: zh.cancel })); expect(f.onClose).toHaveBeenCalledExactlyOnceWith(false)
  node.unmount()
  await act(async () => { gate.resolve({ kind: 'written', view: f.committed }); await gate.promise })
  expect(f.storeCredential).not.toHaveBeenCalled(); expect(f.onClose).toHaveBeenCalledOnce()
})

it.each([' ', 'KEY=secret', '"secret"', '密钥', 'has space'])('非法密钥 %s 阻止提交', (key) => {
  const f = fixture(); render(<ProviderEditor {...f.props} />); change(zh.apiKey, key)
  expect(screen.getByText(zh.invalidKey)).toBeTruthy()
  expect((screen.getByRole<HTMLButtonElement>('button', { name: zh.save })).disabled).toBe(true)
  expect(f.storeCredential).not.toHaveBeenCalled()
})

it.each(['not a url', 'file:///tmp/key'])('非法地址 %s 阻止提交', (endpoint) => {
  const f = fixture(); render(<ProviderEditor {...f.props} />); change(zh.endpoint, endpoint)
  expect(screen.getByText(zh.invalidEndpoint)).toBeTruthy()
  expect((screen.getByRole<HTMLButtonElement>('button', { name: zh.save })).disabled).toBe(true)
})

it('清空端点只删除端点覆盖，空密钥不写凭据', async () => {
  const f = fixture(); render(<ProviderEditor {...f.props} />); change(zh.endpoint, ''); save()
  await waitFor(() =>{  expect(f.onClose).toHaveBeenCalledWith(true) })
  expect(f.writeSettings).toHaveBeenCalledExactlyOnceWith('llm-deepseek', [{ op: 'unset', path: ['baseURL'] }], 2)
  expect(f.storeCredential).not.toHaveBeenCalled()
})

it('只读凭据禁用密钥输入，完全只读时禁止保存', () => {
  const f = fixture(); f.props.row.credential = { configured: true, writable: false }
  const node = render(<ProviderEditor {...f.props} />)
  expect((screen.getByLabelText<HTMLInputElement>(zh.apiKey)).disabled).toBe(true)
  expect(screen.getByText(zh.keyReadonly)).toBeTruthy()
  node.rerender(<ProviderEditor {...f.props} readOnly />)
  expect((screen.getByRole<HTMLButtonElement>('button', { name: zh.save })).disabled).toBe(true)
})

it('pi-ai 新凭据记录派生引用，并允许已有引用单独更新凭据', async () => {
  const f = fixture()
  const namespace = { ...f.props.namespace, ns: 'llm-pi-ai', user: {}, value: {} }
  const row = { ...f.props.row, apiKeyEnv: undefined, credential: undefined,
    entry: { ...f.props.row.entry, provider: 'my-route', settingsNs: namespace.ns, settingsPath: ['providers', 'my-route'] } }
  const value = { providers: { 'my-route': { apiKeyEnv: 'MY_ROUTE_API_KEY' } } }
  const written = { ...namespace, revision: 3, value, user: value }
  f.writeSettings.mockResolvedValue({ kind: 'written', view: written })
  const node = render(<ProviderEditor {...f.props} row={row} namespace={namespace} />)
  change(zh.apiKey, 'fixture-key'); save()
  await waitFor(() => { expect(f.onClose).toHaveBeenCalledWith(true) })
  expect(f.writeSettings).toHaveBeenCalledExactlyOnceWith('llm-pi-ai', [
    { op: 'set', path: ['providers', 'my-route', 'apiKeyEnv'], value: 'MY_ROUTE_API_KEY' },
  ], 2)
  expect(f.storeCredential).toHaveBeenCalledWith('MY_ROUTE_API_KEY', 'fixture-key')
  node.unmount(); f.onClose.mockClear()
  render(<ProviderEditor {...f.props} row={row} namespace={written} />)
  change(zh.apiKey, 'another-key'); save()
  await waitFor(() => { expect(f.onClose).toHaveBeenCalledWith(true) })
  expect(f.writeSettings).toHaveBeenCalledOnce()
})

it('凭据单独失败保留草稿；更高版本更换引用后不向旧引用写入', async () => {
  const f = fixture(); f.storeCredential.mockResolvedValueOnce('private failure')
  const node = render(<ProviderEditor {...f.props} />)
  change(zh.apiKey, 'fixture-key'); save(); await screen.findByText(zh.credentialFailed)
  node.rerender(<ProviderEditor {...f.props} namespace={{ ...f.props.namespace, revision: 9, value: { apiKeyEnv: 'OTHER' } }} />)
  save(); await waitFor(() => { expect((screen.getByRole<HTMLButtonElement>('button', { name: zh.save })).disabled).toBe(false) })
  expect(f.storeCredential).toHaveBeenCalledOnce(); expect(f.writeSettings).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: zh.cancel })); expect(f.onClose).toHaveBeenCalledWith(false)
})

it('原生认证路线首次空保存仍创建配置，已有 user 路线不覆盖为对象', async () => {
  const f = fixture(), namespace = { ...f.props.namespace, ns: 'llm-pi-ai', value: {}, user: {} }
  const path = ['providers', 'native']
  const row = { ...f.props.row, entry: { ...f.props.row.entry, settingsNs: namespace.ns, settingsPath: path } }
  const node = render(<ProviderEditor {...f.props} row={row} namespace={namespace} />)
  save(); await waitFor(() => { expect(f.onClose).toHaveBeenCalledWith(true) })
  expect(f.writeSettings).toHaveBeenCalledExactlyOnceWith('llm-pi-ai', [{ op: 'set', path, value: {} }], 2)
  expect(f.storeCredential).not.toHaveBeenCalled()
  node.unmount(); f.onClose.mockClear()
  render(<ProviderEditor {...f.props} row={row} namespace={{ ...namespace, user: { providers: { native: {} } } }} />)
  save(); await waitFor(() => { expect(f.onClose).toHaveBeenCalledWith(false) })
  expect(f.writeSettings).toHaveBeenCalledOnce()
})

it('表单直接提交仍尊重只读限制；未改动保存不声明写入', async () => {
  const f = fixture(), node = render(<ProviderEditor {...f.props} readOnly />)
  fireEvent.submit(node.container.querySelector('form')!)
  expect(f.writeSettings).not.toHaveBeenCalled(); expect(f.onClose).not.toHaveBeenCalled()
  node.rerender(<ProviderEditor {...f.props} />); save()
  await waitFor(() => { expect(f.onClose).toHaveBeenCalledWith(false) })
  expect(f.writeSettings).not.toHaveBeenCalled(); expect(f.storeCredential).not.toHaveBeenCalled()
})

it('目录编辑入口取消不重读，保存后关闭并重新读取官方目录', async () => {
  const f = fixture(), reload = vi.fn(async () => {})
  const state = { status: 'ready', error: null, credentialError: null, writable: true,
    rows: [f.props.row], namespaces: new Map([[f.props.namespace.ns, f.props.namespace]]) }
  const props = { useSnapshot: () => state, reload, operations: f.props.operations, schema: f.props.schema,
    t: f.props.t, renderSlot: () => null } as unknown as ModelsProps
  render(<Models {...props} />)
  await waitFor(() => { expect(reload).toHaveBeenCalledOnce() })
  fireEvent.click(screen.getByRole('button', { name: zh.edit }))
  fireEvent.click(screen.getByRole('button', { name: zh.cancel }))
  expect(reload).toHaveBeenCalledOnce(); expect(screen.queryByLabelText(zh.apiKey)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: zh.edit }))
  change(zh.endpoint, 'https://new.example'); save()
  await waitFor(() => { expect(reload).toHaveBeenCalledTimes(2) })
  expect(screen.queryByLabelText(zh.apiKey)).toBeNull()
})

it('模型编辑保留隐藏字段，容量按 token 数保存，密钥失败后的重试不重复配置', async () => {
  const f = fixture(), original = [{ id: 'one', contextWindow: 1000, future: { enabled: true } }, { id: 'two' }]
  const namespace = { ...f.props.namespace, value: { ...f.props.namespace.value as object, models: original } }
  const models = [{ id: 'one', name: 'First', contextWindow: 256000, maxTokens: 2000, future: { enabled: true } }, { id: 'two' }]
  const committed = { ...namespace, revision: 3, user: { ...namespace.user as object, models }, value: { ...namespace.value, models } }
  f.writeSettings.mockResolvedValue({ kind: 'written', view: committed }); f.storeCredential.mockResolvedValueOnce('private failure')
  render(<ProviderEditor {...f.props} namespace={namespace} />)
  change(`${zh.modelName} 1`, 'First'); change(`${zh.modelContext} 1`, '256K'); change(`${zh.modelOutput} 1`, '2K')
  change(zh.apiKey, 'fixture-key'); save(); await screen.findByText(zh.partialSave)
  expect(f.writeSettings).toHaveBeenCalledExactlyOnceWith('llm-deepseek', [{ op: 'set', path: ['models'], value: models }], 2)
  save(); await waitFor(() => { expect(f.onClose).toHaveBeenCalledWith(true) })
  expect(f.writeSettings).toHaveBeenCalledOnce()
})

it('添加与删除模型更新完整数组，空标识和重复标识禁用保存', async () => {
  const f = fixture(); render(<ProviderEditor {...f.props} />)
  fireEvent.click(screen.getByRole('button', { name: zh.addModel }))
  expect(screen.getByText(zh.modelIdInvalid)).toBeTruthy()
  change(`${zh.modelId} 1`, 'same')
  fireEvent.click(screen.getByRole('button', { name: zh.addModel })); change(`${zh.modelId} 2`, ' same ')
  expect(screen.getByText(zh.modelDuplicate)).toBeTruthy()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.save }).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: `${zh.removeModel} 1` }))
  change(`${zh.modelContext} 1`, 'oops'); expect(screen.getByText(zh.modelCapacityInvalid)).toBeTruthy()
  change(`${zh.modelContext} 1`, ''); save()
  await waitFor(() => { expect(f.onClose).toHaveBeenCalledWith(true) })
  expect(f.writeSettings).toHaveBeenCalledExactlyOnceWith('llm-deepseek', [{ op: 'set', path: ['models'], value: [{ id: 'same' }] }], 2)
})

it('恢复继承读取 base 模型并提交 unset，不复制仍含 user 覆盖的有效值', async () => {
  const f = fixture(), models = [{ id: 'custom' }]
  const namespace = { ...f.props.namespace, base: { models: [{ id: 'inherited' }] },
    user: { ...f.props.namespace.user as object, models }, value: { ...f.props.namespace.value as object, models } }
  render(<ProviderEditor {...f.props} namespace={namespace} />)
  fireEvent.click(screen.getByRole('button', { name: zh.resetModels }))
  expect(screen.getByLabelText<HTMLInputElement>(`${zh.modelId} 1`).value).toBe('inherited')
  save(); await waitFor(() => { expect(f.onClose).toHaveBeenCalledWith(true) })
  expect(f.writeSettings).toHaveBeenCalledExactlyOnceWith('llm-deepseek', [{ op: 'unset', path: ['models'] }], 2)
})

it('新建模型草稿恢复继承后不写空覆盖，缺少 base 时读取 schema 默认值', async () => {
  const f = fixture()
  const nodeAtPath = vi.spyOn(f.props.schema, 'nodeAtPath').mockReturnValue(undefined)
  vi.spyOn(f.props.schema, 'rehydrate').mockReturnValue({} as ReturnType<typeof f.props.schema.rehydrate>)
  render(<ProviderEditor {...f.props} />)
  fireEvent.click(screen.getByRole('button', { name: zh.addModel }))
  fireEvent.click(screen.getByRole('button', { name: zh.resetModels }))
  expect(nodeAtPath).toHaveBeenCalledWith({}, ['models'])
  save(); await waitFor(() => { expect(f.onClose).toHaveBeenCalledWith(false) })
  expect(f.writeSettings).not.toHaveBeenCalled()
})

it('供应商发现使用未保存的端点密钥和协议，明确采用后仍须保存才写配置', async () => {
  const f = fixture(), namespace = { ...f.props.namespace, ns: 'llm-pi-ai',
    base: { baseURL: 'https://inherited.example' }, value: { api: 'openai-completions', apiKeyEnv: 'KEY' } }
  const row = { ...f.props.row, entry: { ...f.props.row.entry, settingsNs: namespace.ns } }
  const discover = f.discoverModels.mockResolvedValue({ kind: 'found', models: [{ id: 'found', maxTokens: 1000 }] })
  render(<ProviderEditor {...f.props} row={row} namespace={namespace} />)
  change(zh.endpoint, 'https://draft.example'); change(zh.apiKey, 'draft-key')
  fireEvent.click(screen.getByRole('button', { name: zh.discoverModels }))
  await screen.findByRole('button', { name: zh.adoptModels })
  expect(discover).toHaveBeenCalledExactlyOnceWith('llm-pi-ai', {
    provider: 'deepseek', baseURL: 'https://draft.example', api: 'openai-completions', apiKey: 'draft-key',
  })
  expect(f.writeSettings).not.toHaveBeenCalled(); expect(f.storeCredential).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: zh.adoptModels }))
  expect(screen.getByLabelText<HTMLInputElement>(`${zh.modelId} 1`).value).toBe('found')
  expect(f.writeSettings).not.toHaveBeenCalled()
  change(zh.endpoint, ''); change(zh.apiKey, '')
  fireEvent.click(screen.getByRole('button', { name: zh.discoverModels }))
  await screen.findByText(zh.modelAlreadyAdded)
  expect(discover).toHaveBeenLastCalledWith('llm-pi-ai', {
    provider: 'deepseek', baseURL: 'https://inherited.example', api: 'openai-completions',
  })
  save(); await waitFor(() => { expect(f.onClose).toHaveBeenCalledWith(true) })
  expect(f.writeSettings).toHaveBeenCalledWith('llm-pi-ai', [
    { op: 'unset', path: ['baseURL'] }, { op: 'set', path: ['models'], value: [{ id: 'found', maxTokens: 1000 }] },
  ], 2)
})

it('候选已在查询后手工添加时不重复加入模型草稿', async () => {
  const f = fixture(), namespace = { ...f.props.namespace, ns: 'llm-pi-ai' }
  const row = { ...f.props.row, entry: { ...f.props.row.entry, settingsNs: namespace.ns } }
  f.discoverModels.mockResolvedValue({ kind: 'found', models: [{ id: 'found' }] })
  render(<ProviderEditor {...f.props} row={row} namespace={namespace} />)
  fireEvent.click(screen.getByRole('button', { name: zh.discoverModels }))
  await screen.findByRole('button', { name: zh.adoptModels })
  fireEvent.click(screen.getByRole('button', { name: zh.addModel })); change(`${zh.modelId} 1`, 'found')
  fireEvent.click(screen.getByRole('button', { name: zh.adoptModels }))
  expect(screen.queryByLabelText(`${zh.modelId} 2`)).toBeNull()
  expect(f.writeSettings).not.toHaveBeenCalled()
})

function declaredFixture() {
  const f = fixture()
  const profile = { displayName: 'Old name', api: 'openai-completions', apiKeyEnv: 'KEY',
    baseURL: 'https://old.example', models: [{ id: 'model' }], hidden: { keep: true } }
  const namespace: SettingsNamespaceView = { ...f.props.namespace, ns: 'llm-pi-ai',
    user: { providers: { route: profile } }, value: { providers: { route: profile } },
    schema: { type: 'object', dict: { providers: { type: 'dict', inner: { type: 'object', dict: { api: {
      type: 'union', list: [{ type: 'const', value: 'openai-completions' }, { type: 'const', value: 'openai-responses' }],
    } } } } } } }
  const props: ProviderEditorProps = { ...f.props, namespace, row: { ...f.props.row,
    entry: { ...f.props.row.entry, provider: 'route', settingsNs: namespace.ns, settingsPath: ['providers', 'route'], declared: true } } }
  f.writeSettings.mockImplementation(async (_ns, ops) => {
    let user = namespace.user as Record<string, unknown>
    for (const op of ops) user = op.op === 'set' ? props.schema.setPath(user, op.path, op.value) : props.schema.deletePath(user, op.path)
    return { kind: 'written', view: { ...namespace, revision: 3, user, value: user } as SettingsNamespaceView }
  })
  return { ...f, props }
}

it('已声明供应商仅写名称和协议的字段差异，凭据重试不再提交协议', async () => {
  const f = declaredFixture(); f.storeCredential.mockResolvedValueOnce('private failure')
  render(<ProviderEditor {...f.props} />)
  change(zh.providerName, 'New name'); change(zh.providerProtocol, 'openai-responses'); change(zh.apiKey, 'new-key'); save()
  await screen.findByText(zh.partialSave)
  expect(f.writeSettings).toHaveBeenCalledExactlyOnceWith('llm-pi-ai', [
    { op: 'set', path: ['providers', 'route', 'displayName'], value: 'New name' },
    { op: 'set', path: ['providers', 'route', 'api'], value: 'openai-responses' },
  ], 2)
  save(); await waitFor(() => { expect(f.onClose).toHaveBeenCalledWith(true) })
  expect(f.writeSettings).toHaveBeenCalledOnce(); expect(f.storeCredential).toHaveBeenCalledTimes(2)
})

it('已声明路线的发现使用未保存协议；清空名称只删除名称覆盖', async () => {
  const f = declaredFixture(); f.discoverModels.mockResolvedValue({ kind: 'found', models: [] })
  render(<ProviderEditor {...f.props} />)
  change(zh.providerProtocol, 'openai-responses')
  fireEvent.click(screen.getByRole('button', { name: zh.discoverModels })); await screen.findByText(zh.discoveryEmpty)
  expect(f.discoverModels).toHaveBeenCalledWith('llm-pi-ai', {
    provider: 'route', baseURL: 'https://old.example', api: 'openai-responses',
  })
  change(zh.providerName, ''); save()
  await waitFor(() => { expect(f.onClose).toHaveBeenCalledWith(true) })
  expect(f.writeSettings.mock.calls[0]![1]).toEqual([
    { op: 'unset', path: ['providers', 'route', 'displayName'] },
    { op: 'set', path: ['providers', 'route', 'api'], value: 'openai-responses' },
  ])
})

it('名称协议未改动时不写入，缺失或过期协议必须明确选择', async () => {
  const f = declaredFixture(), node = render(<ProviderEditor {...f.props} />)
  save(); await waitFor(() => { expect(f.onClose).toHaveBeenCalledWith(false) })
  expect(f.writeSettings).not.toHaveBeenCalled(); node.unmount()
  const noProtocol = { providers: { route: { models: [{ id: 'model' }] } } }
  const next = render(<ProviderEditor {...f.props} namespace={{ ...f.props.namespace, value: noProtocol, user: noProtocol }} />)
  expect(screen.getByRole('option', { name: zh.protocolUnset })).toBeTruthy()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.save }).disabled).toBe(true)
  change(zh.providerProtocol, 'openai-responses'); save()
  await waitFor(() => { expect(f.writeSettings).toHaveBeenCalledOnce() })
  next.unmount()
  render(<ProviderEditor {...f.props} namespace={{ ...f.props.namespace,
    value: { providers: { route: { api: 'obsolete-protocol' } } } }} />)
  expect(screen.getByRole('option', { name: 'obsolete-protocol' })).toBeTruthy()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.save }).disabled).toBe(true)
})
