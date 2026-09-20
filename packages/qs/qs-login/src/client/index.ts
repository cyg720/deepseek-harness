/**
 * 登录页的浏览器入口。
 *
 * 发布三条通路（见 06-槽位与状态设计 第三节）：
 * 1. `ctx.reflect.provide('qsAuth', auth)` —— qs-shell 的用户区与登出动作可选读取它；
 * 2. `ctx.slots.provideRoot({ hooks: { qsAuth } })` —— 绑定成 `useQsAuth` 座席，
 *    qs-shell 的根 occupant 据此决定首屏分支；
 * 3. 向 `qs.gate` 贡献登录视图（该槽由 qs-shell 声明，未声明时本贡献等待）。
 *
 * 正常交付组合必须包含本包：缺失时 qs-shell 渲染"登录组件未加载"故障面，不静默直通。
 * 登录门**不是安全边界**：`/api` 没有用户级鉴权。
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
// 仅类型：引入 SlotRegistry 的 ctx.slots 服务合并与语言/登录契约。
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { IQsAuth, QsAuthSnapshot } from '@deepseek-ai/dsh-qs-shell/client'
import { createLocalAuthGateway, type QsAuthGateway, type QsCredentials } from './auth-gateway.ts'
import { createQsAuthStore, readRememberedUser, writeRememberedUser } from './auth-store.ts'
import type { QsGateInjected } from './contract.ts'
import { LoginPage } from './LoginPage.tsx'
import { en, zh } from './locales.ts'

/** 本包的本地化命名空间。 */
const NS = 'qs-login'

/** 必需服务：槽注册表与语言。 */
export const inject = ['slots', 'locale']

/** 契约再导出：其它包通过 `/client` 引入本包的共享类型。 */
export type * from './contract.ts'

/**
 * 安装登录视图。
 * @param ctx - 浏览器根上下文。
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'qs-login: dictionaries')

  const authStore = createQsAuthStore()
  const instance = authStore.create()
  const gateway: QsAuthGateway = createLocalAuthGateway()

  const source: HostObservable<QsAuthSnapshot> = {
    getSnapshot: () => {
      const state = instance.getSnapshot()
      return state.user === ''
        ? { authenticated: state.authenticated }
        : { authenticated: state.authenticated, user: state.user }
    },
    subscribe: listener => instance.subscribe(listener),
  }

  const service: IQsAuth = {
    getSnapshot: () => source.getSnapshot(),
    subscribe: listener => source.subscribe(listener),
    async signIn(credentials: QsCredentials): Promise<void> {
      await gateway.signIn(credentials)
      instance.actions.signIn(credentials.username.trim(), instance.getSnapshot().remember)
    },
    signOut(): void {
      instance.actions.signOut()
    },
  }

  ctx.effect(() => ctx.reflect.provide('qsAuth', service), 'qs-login: auth service')
  ctx.effect(() => ctx.slots.provideRoot({ hooks: { qsAuth: source } }), 'qs-login: root auth source')

  // 只创建一次实例：source、service 与登录页的写入都指向它。把 handle 交给框架会让
  // 框架再建一个实例，于是"表单写的是 A、外壳读的是 B"，登录后外壳仍认为未登录。
  ctx.slots.inject('qs.gate', () => ctx.slots.register({
    name: 'qs.gate',
    locale: NS,
    inject: (): QsGateInjected => ({
      hooks: { auth: source },
      signIn: async (credentials: QsCredentials, remember: boolean): Promise<void> => {
        await gateway.signIn(credentials)
        writeRememberedUser(remember ? credentials.username.trim() : '')
        instance.actions.signIn(credentials.username.trim(), remember)
      },
      rememberedUser: () => readRememberedUser(),
    }),
  }, LoginPage))
}
