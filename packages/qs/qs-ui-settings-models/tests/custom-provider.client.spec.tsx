// @vitest-environment jsdom
/** 自定义路线的创建载荷、冲突和部分成功重试通过实际表单验证。 */
import { Context } from '@deepseek-ai/cordis'
import { SettingsSchemaService } from '@deepseek-ai/dsh-client-ui-settings/src/client/schema.ts'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ModelsOperations } from '@deepseek-ai/dsh-client-ui-settings-models/client'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { CustomProvider, type CustomProviderProps } from '../src/client/CustomProvider.tsx'
import { providerProtocols } from '../src/client/provider-fields.ts'
import { Models } from '../src/client/Models.tsx'
import type { ModelsProps } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
function fixture() {
  const namespace: SettingsNamespaceView = { ns: 'llm-pi-ai', value: {}, user: {}, revision: 2, applies: 'live', secrets: [],
    schema: { type: 'object', dict: { providers: { type: 'dict', inner: { type: 'object', dict: { api: {
      type: 'union', list: [{ type: 'const', value: 'openai-completions' }, { type: 'const', value: 'openai-responses' }, { type: 'const', value: 7 }],
    } } } } } } }
  const writeSettings = vi.fn<ModelsOperations['writeSettings']>().mockImplementation(async (_ns, ops, revision) => {
    const op = ops[0]!
    if (op.op !== 'set') throw new Error('fixture expects profile creation')
    const value = { providers: { [op.path[1]!]: op.value } }
    return { kind: 'written', view: { ...namespace, revision: revision! + 1, user: value, value } }
  })
  const storeCredential = vi.fn<ModelsOperations['storeCredential']>().mockResolvedValue(undefined)
  const discoverModels = vi.fn<ModelsOperations['discoverModels']>().mockResolvedValue({ kind: 'found', models: [{ id: 'discovered' }] })
  const operations: ModelsOperations = { writeSettings, storeCredential, discoverModels,
    describeCredential: vi.fn(), removeCredential: vi.fn() }
  const onClose = vi.fn()
  const props: CustomProviderProps = { namespace, operations, schema: new SettingsSchemaService(new Context()),
    taken: [], readOnly: false, t: key => zh[key], onClose }
  return { props, writeSettings, storeCredential, discoverModels, onClose }
}
function change(label: string, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }) }
function complete() {
  change(zh.providerRoute, 'my-route'); change(zh.endpoint, 'http://127.0.0.1:9999/v1')
  fireEvent.click(screen.getByRole('button', { name: zh.addModel })); change(`${zh.modelId} 1`, 'model')
}
function save() { fireEvent.click(screen.getByRole('button', { name: zh.save })) }

it('协议来自 schema，单次创建写整条新路线和打开时版本，密钥失败只重试密钥', async () => {
  const f = fixture(); f.storeCredential.mockResolvedValueOnce('private error')
  render(<CustomProvider {...f.props} />); complete(); change(zh.providerName, 'My provider')
  change(zh.providerProtocol, 'openai-responses'); change(zh.apiKey, ' secret '); save()
  await screen.findByText(zh.partialSave)
  expect(f.writeSettings).toHaveBeenCalledExactlyOnceWith('llm-pi-ai', [{ op: 'set', path: ['providers', 'my-route'], value: {
    displayName: 'My provider', api: 'openai-responses', baseURL: 'http://127.0.0.1:9999/v1', models: [{ id: 'model' }], apiKeyEnv: 'MY_ROUTE_API_KEY',
  } }], 2)
  expect(screen.getByLabelText<HTMLInputElement>(zh.providerRoute).disabled).toBe(true)
  save(); await waitFor(() => { expect(f.onClose).toHaveBeenCalledWith(true) })
  expect(f.writeSettings).toHaveBeenCalledOnce(); expect(f.storeCredential).toHaveBeenCalledTimes(2)
  expect(f.storeCredential).toHaveBeenLastCalledWith('MY_ROUTE_API_KEY', 'secret')
})

it('无密钥创建不写 apiKeyEnv，候选须明确采用且查询不传未创建路线', async () => {
  const f = fixture(); render(<CustomProvider {...f.props} />)
  change(zh.providerRoute, 'my-route'); change(zh.endpoint, 'https://draft.example')
  fireEvent.click(screen.getByRole('button', { name: zh.discoverModels }))
  await screen.findByRole('button', { name: zh.adoptModels })
  expect(f.discoverModels).toHaveBeenCalledWith('llm-pi-ai', { baseURL: 'https://draft.example', api: 'openai-completions' })
  expect(f.writeSettings).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: zh.adoptModels })); save()
  await waitFor(() => { expect(f.onClose).toHaveBeenCalledWith(true) })
  expect(f.writeSettings.mock.calls[0]![1]).toEqual([{ op: 'set', path: ['providers', 'my-route'], value: {
    api: 'openai-completions', baseURL: 'https://draft.example', models: [{ id: 'discovered' }],
  } }])
  expect(f.storeCredential).not.toHaveBeenCalled()
})

it.each(['conflict', 'refused'] as const)('创建 %s 不写凭据，保持草稿可修改', async (kind) => {
  const f = fixture(); f.writeSettings.mockResolvedValueOnce({ kind, message: 'private error' })
  render(<CustomProvider {...f.props} />); complete(); change(zh.apiKey, 'secret'); save()
  await screen.findByText(kind === 'conflict' ? zh.conflict : zh.saveFailed)
  expect(f.storeCredential).not.toHaveBeenCalled()
  expect(screen.getByLabelText<HTMLInputElement>(zh.providerRoute).disabled).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: zh.cancel })); expect(f.onClose).toHaveBeenCalledWith(false)
})

it('非法标识、重名、协议缺失、端点及模型缺失不能提交', () => {
  const f = fixture(), node = render(<CustomProvider {...f.props} taken={['existing']} />)
  fireEvent.submit(node.container.querySelector('form')!)
  expect(f.writeSettings).not.toHaveBeenCalled()
  change(zh.providerRoute, '1invalid'); expect(screen.getByText(zh.routeInvalid)).toBeTruthy()
  change(zh.providerRoute, 'existing'); expect(screen.getByText(zh.routeTaken)).toBeTruthy()
  change(zh.endpoint, 'file:///tmp'); expect(screen.getByText(zh.invalidEndpoint)).toBeTruthy()
  change(zh.apiKey, 'KEY=value'); expect(screen.getByText(zh.invalidKey)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: zh.addModel })); expect(screen.getByText(zh.modelIdInvalid)).toBeTruthy()
  node.rerender(<CustomProvider {...f.props} namespace={{ ...f.props.namespace, schema: {} }} />)
  expect(screen.getByText(zh.protocolUnavailable)).toBeTruthy()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.save }).disabled).toBe(true)
})

it('schema 没有协议列表时保持不可创建，不能臆造默认协议', () => {
  const f = fixture()
  const missing = { ...f.props.namespace, schema: {} }
  render(<CustomProvider {...f.props} namespace={missing} />)
  expect(screen.getByRole<HTMLSelectElement>('combobox').options).toHaveLength(0)
  expect(providerProtocols(missing, f.props.schema)).toEqual([])
})

it('创建期间卸载不继续写密钥，新的命名空间版本不改变已打开草稿版本', async () => {
  const f = fixture(), gate = Promise.withResolvers<Awaited<ReturnType<ModelsOperations['writeSettings']>>>()
  f.writeSettings.mockReturnValueOnce(gate.promise)
  const node = render(<CustomProvider {...f.props} />); complete(); change(zh.apiKey, 'secret')
  node.rerender(<CustomProvider {...f.props} namespace={{ ...f.props.namespace, revision: 9 }} />); save()
  expect(f.writeSettings.mock.calls[0]![2]).toBe(2)
  node.unmount()
  await act(async () => { gate.resolve({ kind: 'written', view: f.props.namespace }); await gate.promise })
  expect(f.storeCredential).not.toHaveBeenCalled(); expect(f.onClose).not.toHaveBeenCalled()
})

it('关闭部分成功创建须通知目录刷新', async () => {
  const f = fixture(); f.storeCredential.mockResolvedValueOnce('private error')
  render(<CustomProvider {...f.props} />); complete(); change(zh.apiKey, 'secret'); save()
  await screen.findByText(zh.partialSave)
  fireEvent.click(screen.getByRole('button', { name: zh.cancel })); expect(f.onClose).toHaveBeenCalledWith(true)
})

it('更高版本已移除凭据引用，旧创建确认不能继续写入旧密钥', async () => {
  const f = fixture(), gate = Promise.withResolvers<Awaited<ReturnType<ModelsOperations['writeSettings']>>>()
  f.writeSettings.mockReturnValueOnce(gate.promise)
  const node = render(<CustomProvider {...f.props} />); complete(); change(zh.apiKey, 'secret'); save()
  node.rerender(<CustomProvider {...f.props} namespace={{ ...f.props.namespace, revision: 4, value: { providers: { 'my-route': {} } } }} />)
  await act(async () => {
    gate.resolve({ kind: 'written', view: { ...f.props.namespace, revision: 3,
      value: { providers: { 'my-route': { apiKeyEnv: 'MY_ROUTE_API_KEY' } } } } })
    await gate.promise
  })
  await screen.findByText(zh.partialSave)
  expect(f.storeCredential).not.toHaveBeenCalled(); expect(f.onClose).not.toHaveBeenCalled()
})

it('目录创建入口取消不重读，创建完成重新读取共享目录', async () => {
  const f = fixture(), reload = vi.fn(async () => {})
  const state = { status: 'ready', error: null, credentialError: null, writable: true,
    rows: [{ entry: { provider: 'existing', displayName: 'Existing', settingsNs: '', settingsPath: [], active: true },
      configured: true, removable: false, apiKeyEnv: undefined, credential: undefined }],
    namespaces: new Map([[f.props.namespace.ns, f.props.namespace]]) }
  const props = { useSnapshot: () => state, reload, operations: f.props.operations, schema: f.props.schema,
    t: f.props.t, renderSlot: () => null } as unknown as ModelsProps
  render(<Models {...props} />); await waitFor(() => { expect(reload).toHaveBeenCalledOnce() })
  fireEvent.click(screen.getByRole('button', { name: zh.createProvider }))
  fireEvent.click(screen.getByRole('button', { name: zh.cancel })); expect(reload).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: zh.createProvider })); complete(); save()
  await waitFor(() => { expect(reload).toHaveBeenCalledTimes(2) })
})
