/** qs-login 的跨包类型与注册面。 */
import type {
  HostObservable, InjectFace, PropsLocale, PropsRuntime, SnapshotSelectorHook,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { QsAuthSnapshot } from '@deepseek-ai/dsh-qs-shell/client'
import type { QsCredentials } from './auth-gateway.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'qs-login': QsLoginLocaleKey
  }
}

/**
 * 登录状态与 qs-shell 的约定是同一个类型。
 *
 * qs-shell 在 GlobalStandardProps 里声明 `useQsAuth`；qs-login 通过
 * `provideRoot({ hooks: { qsAuth } })` 发布它。这里用类型别名把两边钉在一起：
 * 任何一边改名都会在这里编译失败。
 */
export type QsAuthSeat = SnapshotSelectorHook<QsAuthSnapshot>

/** 登录状态源类型（qs-login 发布的 `qsAuth` hook）。 */
export type QsAuthSource = HostObservable<QsAuthSnapshot>

/**
 * `qs.gate` 条目自己的 inject face：登录视图需要知道"怎么登录"与"记住谁"。
 *
 * **登录页不持有 store 座席**：写入必须落到发布 `auth` 座席的同一个 store 实例上，
 * 否则会出现"表单写的是 A 实例、外壳读的是 B 实例"，登录成功后外壳仍认为未登录。
 * 因此 `signIn` 一次做完网关校验与状态提交，登录页只调它。
 */
export interface QsGateInjected {
  readonly hooks: {
    /** 登录状态源，框架绑成 `useAuth`。 */
    readonly auth: QsAuthSource
  }
  /**
   * 提交登录：先过网关校验，成功后再写登录状态。
   * @param credentials - 用户名与口令。
   * @param remember - 是否记住用户名（**不记口令**）。
   * @returns 提交完成；失败时抛出 {@link import('./auth-gateway.ts').QsSignInError}。
   */
  readonly signIn: (credentials: QsCredentials, remember: boolean) => Promise<void>
  /** 已记住的用户名，用于预填。 */
  readonly rememberedUser: () => string
}

/** 登录页条目的完整 props。 */
export type QsGateProps =
  PropsRuntime<'qs.gate'>
  & InjectFace<QsGateInjected>
  & PropsLocale<'qs-login'>

/** qs-login 的本地化键。 */
export type QsLoginLocaleKey =
  | 'brand.name'
  | 'brand.tagline'
  | 'story.eyebrow'
  | 'story.visual.label'
  | 'story.visual.hub'
  | 'story.visual.monitor'
  | 'story.visual.vision'
  | 'story.visual.sensing'
  | 'story.visual.tagline'
  | 'story.title'
  | 'story.lead'
  | 'story.footer.note'
  | 'story.footer.product'
  | 'form.kicker'
  | 'form.title'
  | 'form.lead'
  | 'form.username'
  | 'form.usernamePlaceholder'
  | 'form.password'
  | 'form.passwordPlaceholder'
  | 'form.showPassword'
  | 'form.hidePassword'
  | 'form.remember'
  | 'form.forgot'
  | 'form.submit'
  | 'form.submitting'
  | 'form.demo'
  | 'form.demoFill'
  | 'form.storageDegraded'
  | 'form.security'
  | 'form.help'
  | 'error.empty-username'
  | 'error.empty-password'
  | 'error.too-short'
  | 'error.rejected'
  | 'error.unknown'
