/*
 * ================================ 文件注释 ================================
 * 【文件职责】浏览器侧 locale 注册表：绑定翻译函数为注入消费方保持稳定
 *   身份；插件还把"语言"偏好行注册进设置 General 段——locale 功能拥有
 *   自己的设置面。
 * 【技术维度】LocaleRuntime：字典注册表 + 语言偏好；查找链（条目命名空间
 *   激活语言 -> 该命名空间 en 回退 -> common 命名空间 -> 键本身）；快照
 *   修订号驱动渲染刷新；同时实现 LocaleFace（bind + getSnapshot/subscribe）。
 * 【产品维度】UI 文案随语言切换；语言选择持久化到 Host 设置文档；可访问性
 *   标签（<html lang>）随激活语言同步。
 * 【逻辑维度】类型区（快照/字典/定义）+ 声明合并（命名空间、事件、服务）；
 *   LocaleRuntime 核心（register/bind/setLocale/translate/lookup/publish）；
 *   apply 提供服务、注册字典、装 LocaleFace、注册语言行。
 * 【关键边界】setLocale 是唯一偏好写入口（未知 id 抛错）；字典注册按
 *   (ns, locale) 单属主；register 只升 revision 不发 locale/change 事件
 *   （防注册密集启动风暴事件监听器）。
 * 【新手阅读建议】先读 runtime 的 SettingsScope 与 ui-slots 的 LocaleFace。
 * ==========================================================================
 */
/**
 * Browser-side locale registry. Bound translation functions retain stable
 * identity for injected consumers. The plugin also registers the Language
 * preference row into the settings General section — the locale feature owns
 * its own settings surface.
 */
/*
 * 浏览器侧 locale 注册表。绑定翻译函数为注入消费方保持稳定身份。插件还把
 * "语言"偏好行注册进设置 General 段——locale 功能拥有自己的设置面。
 */
/* oxlint-disable typescript/no-redundant-type-constituents --
 * `keyof LocaleNamespaceMap & string` is the declare-merge key pattern (see
 * ui-slots): in THIS unit the map holds only this package's own merges, but
 * consumers merge more namespaces in and the intersection keeps them
 * string-typed. The rule fires on the narrow-map view, not real redundancy. */
/* oxlint 禁用说明：`keyof LocaleNamespaceMap & string` 是声明合并键模式
 * （见 ui-slots）：本单元中该映射只含本包自己的合并，但消费方会合并进更多
 * 命名空间，交集使它们保持 string 类型。规则在窄映射视图上触发，并非真正
 * 冗余。*/
import type { Context } from '@deepseek-ai/cordis'
import {
  type BoundActions, type LocaleDictOf, type LocaleNamespaceMap, type Translate, type TranslateNS,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { ClientContext, SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the ctx.settingsScope Context merge and the settings slot types.
// Cross-plugin collaboration goes through the service, never a value import
// (client bundle purity gate).
// 仅类型：ctx.settingsScope 的 Context 合并与设置槽位类型。跨插件协作经
// 服务进行，绝不值导入（客户端 bundle 纯净门）。
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  LOCALE_PREFERENCE_FIELD, LOCALE_SETTINGS_NAMESPACE, type LocaleId, type LocaleSettings,
} from '../locale-settings.ts'
import { en, zh, type CommonKey } from '../locales/index.ts'
import {
  en as settingsEn, zh as settingsZh, type SettingsLocaleKey,
} from '../locales/settings.ts'
import type { LanguageRowInjected } from './LanguageRow.tsx'
import { LanguageRow } from './LanguageRow.tsx'
import { createLanguageRowStore } from './settings-store.ts'

export type { LanguageRowComponentProps, LanguageRowInjected } from './LanguageRow.tsx'
export type { LanguageOptionRow, LanguageRowState } from './settings-store.ts'
export type { CommonKey } from '../locales/index.ts'
export type { LocaleId, LocaleSettings } from '../locale-settings.ts'

// The translate currency lives in ui-slots (the render machinery synthesizes
// the seat); re-exported here so dictionary owners import one package.
// TranslateNS<'model'> is the namespace-addressed developer-facing form.
// 翻译通货活在 ui-slots（渲染机制合成座位）；在此再导出，使字典属主只
// 导入一个包。TranslateNS<'model'> 是按命名空间寻址的开发向形式。
export type { Translate, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Shared cross-feature vocabulary, consulted by the lookup chain after the entry's own namespace misses. */
    /* 跨功能共享词汇，条目自身命名空间未命中后由查找链咨询。 */
    common: CommonKey
    /** This feature's own settings-row copy (the Language row). */
    /* 本功能自己的设置行文案（语言行）。 */
    'settings.locale': SettingsLocaleKey
  }
}

/** Locale dictionary: flat key to template string ({name} placeholders). */
/* 语言词典：扁平键到模板字符串（{name} 占位符）。 */
export type LocaleDict = Record<string, string>

/** One selectable locale: id plus its self-described display name. */
/* 一个可选语言：id + 其自述显示名。 */
export interface LocaleDefinition {
  /** Locale id (persisted; the setLocale argument). */
  /* 语言 id（持久化；setLocale 的参数）。 */
  id: LocaleId
  /** Display name in its own language (中文 / English). */
  /* 以其自身语言显示的标签（中文 / English）。 */
  label: string
}

/** Immutable locale state published on every change. */
/* 每次变更发布的不可变语言状态。 */
export interface LocaleSnapshot {
  /** Active locale id. */
  /* 激活语言 id。 */
  active: LocaleId
  /** Selectable locales in display order. */
  /* 按展示顺序的可选语言。 */
  locales: readonly LocaleDefinition[]
  /** Monotonic change counter (registry or active changes). */
  /* 单调变更计数器（注册表或激活变化）。 */
  revision: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    locale: LocaleRuntime
  }
  interface Events {
    /**
     * The active locale switched. Dictionary registrations do NOT emit this
     * event (listeners may re-register slots in response, and boot registers
     * one namespace per package); continuous render refresh rides the
     * LocaleFace revision instead.
     * @param snapshot - Current immutable locale snapshot.
     * @mode emit
     */
    /*
     * 激活语言已切换。字典注册不发射此事件（监听器可能响应式重新注册
     * 槽位，且启动按包注册一个命名空间）；连续渲染刷新改乘 LocaleFace
     * 修订号。
     * @param snapshot 当前不可变语言快照。
     * @mode emit
     */
    'locale/change'(snapshot: LocaleSnapshot): void
  }
}

/**
 * English is both the locale the UI opens in when the browser names no shipped
 * language (and for non-browser runs), and the dictionary consulted after the
 * active locale misses a key. One constant serves both because the shipped
 * `zh`/`en` dictionaries carry identical key sets, so neither direction can
 * leave a key unresolved; the residual case points at English rather than
 * zh because a browser naming neither shipped language is the reader least
 * likely to read Chinese.
 */
/*
 * English 既是浏览器不命名任何发货语言时 UI 打开的语言（以及非浏览器
 * 运行），也是激活语言未命中键后咨询的字典。一个常量服务两种用途，因为
 * 发货的 zh/en 字典携带相同键集，任一方向都不会留下未解析键；残余情形
 * 指向英文而非中文，因为命名非发货语言的浏览器读者最不可能读中文。
 */
export const FALLBACK_LOCALE: LocaleId = 'en'

/** Shared namespace for shell-level texts. */
/* shell 级文本的共享命名空间。 */
export const COMMON_NS = 'common'

/** Namespace owning this feature's settings-row copy. */
/* 拥有本功能设置行文案的命名空间。 */
export const SETTINGS_NS = 'settings.locale'

/** The two shipped locales. */
/* 两个发货语言。 */
const LOCALES: readonly LocaleDefinition[] = Object.freeze([
  { id: 'zh', label: '中文' },
  { id: 'en', label: 'English' },
])

/**
 * `<html lang>` tag per shipped locale. The locale id is the app's own
 * vocabulary (primary subtag); the document attribute wants a BCP 47 tag,
 * which assistive technology and browser features (pronunciation rules,
 * translation offers, font fallback, spell check) read to pick their own
 * behavior. `zh` alone leaves the script ambiguous, so the shipped Chinese
 * copy names the variant it actually is.
 */
/*
 * 每个发货语言的 <html lang> 标签。语言 id 是应用自己的词汇（主子标签）；
 * 文档属性要 BCP 47 标签——辅助技术与浏览器功能（发音规则、翻译提供、
 * 字体回退、拼写检查）读取它以选择自身行为。单独 zh 使脚本歧义，因此
 * 发货中文文案命名它实际所在的变体。
 */
const DOCUMENT_LANGUAGE: Record<LocaleId, string> = { zh: 'zh-CN', en: 'en' }

/**
 * Point `<html lang>` at the active locale. Called on every locale change,
 * so the attribute tracks the UI instead of standing at whatever the served
 * markup happened to declare.
 * @param active - the active locale id.
 */
/*
 * 把 <html lang> 指向激活语言。每次语言变更都调用，使属性跟随 UI，而非
 * 停留在服务标记碰巧声明的值。
 * @param active 激活语言 id。
 */
function syncDocumentLanguage(active: LocaleId): void {
  // Non-browser runs (node boots of the client tree) have no document.
  // 非浏览器运行（客户端树的 node 启动）没有 document。
  if (typeof document === 'undefined') return
  document.documentElement.lang = DOCUMENT_LANGUAGE[active]
}

/**
 * Dictionary registry plus locale preference. Lookup chain per key: the
 * entry's namespace in the active locale -> that namespace's en fallback ->
 * the shared common namespace (active, then en) -> the key itself (missing
 * text stays visible, fail loud in the UI rather than blank). Reads go
 * through {@link getLocale}; writes only through {@link setLocale};
 * continuous sync through the `locale/change` event, or through the
 * LocaleFace getSnapshot/subscribe pair the render machinery consumes
 * (installed via `ctx.slots.installLocale`).
 */
/*
 * 字典注册表 + 语言偏好。每键查找链：激活语言下的条目命名空间 -> 该命名
 * 空间的 en 回退 -> 共享 common 命名空间（激活，再 en）-> 键本身（缺失
 * 文本保持可见，UI 中响亮失败而非空白）。读经 getLocale；写只经
 * setLocale；连续同步经 locale/change 事件，或经渲染机制消费的 LocaleFace
 * getSnapshot/subscribe 对（经 ctx.slots.installLocale 安装）。
 */
export class LocaleRuntime {
  private dicts = new Map<string, Map<string, LocaleDict>>() // 命名空间 -> (语言 -> 词典)
  private bound = new Map<string, Translate>() // 命名空间 -> 绑定翻译函数（身份稳定）
  private snapshot: LocaleSnapshot // 当前不可变快照
  private listeners = new Set<() => void>() // LocaleFace 订阅者
  private readonly ctx: Context
  private readonly host: SettingsScope<LocaleSettings> | undefined // 持久偏好作用域
  /** Browser-derived locale standing wherever no explicit Host selection does. */
  /* 浏览器推导语言；无显式 Host 选择处站桩。 */
  private readonly provisional: LocaleId

  /**
   * @param ctx - owning context (change events are emitted on it; the scope
   * listener is released through ctx.effect on dispose).
   * @param host - durable preference scope owned by the providing plugin;
   * absent compositions (standalone dictionary registries) stay process-local.
   */
  /*
   * @param ctx 属主上下文（变更事件在其上发射；作用域监听器在销毁时经
   *   ctx.effect 释放）。
   * @param host 提供插件拥有的持久偏好作用域；缺失组合（独立字典注册表）
   *   保持进程本地。
   */
  constructor(ctx: Context, host?: SettingsScope<LocaleSettings>) {
    this.ctx = ctx
    this.host = host
    this.provisional = resolveInitialLocale()
    this.snapshot = Object.freeze({ active: this.provisional, locales: LOCALES, revision: 0 })
    if (host !== undefined) {
      ctx.effect(() => host.subscribe(() => { this.adopt(host) }), 'locale: settings scope adoption')
      this.adopt(host)
    }
  }

  /**
   * Read the current immutable locale snapshot.
   * @returns the current snapshot (stable reference until the next change).
   */
  /*
   * 读取当前不可变语言快照。
   * @returns 当前快照（下次变更前引用稳定）。
   */
  getLocale(): LocaleSnapshot {
    return this.snapshot
  }

  /**
   * LocaleFace getSnapshot: the current snapshot (carries `revision`; stable
   * reference between changes, uSES-safe).
   * @returns the current snapshot.
   */
  /*
   * LocaleFace getSnapshot：当前快照（携带 revision；变更间引用稳定，
   * uSES 安全）。
   * @returns 当前快照。
   */
  getSnapshot(): LocaleSnapshot {
    return this.snapshot
  }

  /**
   * LocaleFace subscribe: notified on every snapshot change (locale switch
   * or dictionary registration — registrations bump the revision so already
   * rendered outlets pick up late-arriving dictionaries).
   * @param fn - change callback.
   * @returns unsubscribe.
   */
  /*
   * LocaleFace subscribe：每次快照变更通知（语言切换或字典注册——注册会
   * 提升修订号，使已渲染输出口拾取迟到字典）。
   * @param fn 变更回调。
   * @returns 取消订阅函数。
   */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  /**
   * Switch the active locale — the only user preference write entry.
   *
   * The durable write happens even when the id already matches the active
   * locale, because the active value may be a provisional browser-derived or
   * fallback resolution that nothing has stored yet. Picking the language
   * already on screen is still an explicit choice, and it must survive a
   * different browser sharing the same DSH home. Only the render notification
   * is conditional: republishing an unchanged locale would churn every
   * subscriber for nothing.
   * @param id - a registered locale id; unknown ids throw.
   */
  /*
   * 切换激活语言——唯一的用户偏好写入口。
   *
   * 即使 id 已匹配激活语言也会执行持久写入，因为激活值可能是尚未被任何
   * 人存储的浏览器推导或回退解析。选择屏幕上已有的语言仍是显式选择，且
   * 它必须在共享同一 DSH home 的不同浏览器间存活。只有渲染通知是条件式：
   * 重新发布未变语言会无谓地搅动每个订阅者。
   * @param id 已注册语言 id；未知 id 抛错。
   */
  setLocale(id: string): void {
    const match = this.snapshot.locales.find(l => l.id === id)
    if (match === undefined) throw new Error(`locale "${id}" is not registered`)
    if (this.snapshot.active !== match.id) this.publish(match.id, true)
    void this.host?.set(LOCALE_PREFERENCE_FIELD, match.id)
  }

  /**
   * Adopt the scope's accepted durable selection without writing it back; an
   * absent selection returns to the browser-derived locale.
   * @param host - the constructor-narrowed scope driving this adoption.
   */
  /*
   * 采纳作用域已接受的持久选择而不写回；选择缺失时回到浏览器推导语言。
   * @param host 驱动本次采纳的、构造函数收窄的作用域。
   */
  private adopt(host: SettingsScope<LocaleSettings>): void {
    const section = host.getSnapshot().value
    if (section === undefined) return
    const target = section.preference ?? this.provisional
    if (this.snapshot.active === target) return
    this.publish(target, true)
  }

  /**
   * Register a declared namespace's dictionaries, all locales in one call —
   * the typed form: each dictionary is checked against the namespace's
   * {@link LocaleNamespaceMap} key union (a missing or extra key is a
   * compile error), and every shipped locale is required (bilingual balance
   * enforced at registration). Duplicate (ns, locale) throws (single occupant; a
   * namespace's texts have one owner). Registration bumps the revision so
   * mounted outlets pick up late-arriving dictionaries.
   * @param ns - a namespace merged into LocaleNamespaceMap.
   * @param dicts - complete dictionaries keyed by locale id.
   * @returns disposer removing every locale registered by this call (idempotent).
   */
  /*
   * 一次调用注册一个声明命名空间的所有语言字典——类型化形式：每个字典
   * 对照该命名空间的 LocaleNamespaceMap 键联合检查（缺失或多余键是编译
   * 错误），且每个发货语言都必须提供（注册时强制双语平衡）。重复
   * (ns, locale) 抛错（单占位者；命名空间文本只有一个属主）。注册提升
   * 修订号，使已挂载输出口拾取迟到字典。
   * @param ns 已合并进 LocaleNamespaceMap 的命名空间。
   * @param dicts 按语言 id 键控的完整字典。
   * @returns 移除本次调用注册的所有语言的销毁函数（幂等）。
   */
  register<N extends keyof LocaleNamespaceMap & string>(ns: N, dicts: Record<LocaleId, LocaleDictOf<N>>): () => void
  /**
   * Single-locale untyped form for namespaces outside the merge table
   * (dynamic composition, tests).
   * @param ns - namespace.
   * @param locale - locale tag.
   * @param dict - dictionary.
   * @returns disposer (idempotent).
   */
  /*
   * 合并表外命名空间（动态组合、测试）的单语言无类型形式。
   * @param ns 命名空间。
   * @param locale 语言标签。
   * @param dict 词典。
   * @returns 销毁函数（幂等）。
   */
  register(ns: string, locale: string, dict: LocaleDict): () => void
  register(ns: string, localeOrDicts: string | Record<string, LocaleDict>, dict?: LocaleDict): () => void {
    const pairs: [string, LocaleDict][] = typeof localeOrDicts === 'string'
      // Overload guarantees dict on the single-locale arm.
      // 重载保证单语言臂上有 dict。
      ? [[localeOrDicts, dict as LocaleDict]]
      : Object.entries(localeOrDicts)
    let locales = this.dicts.get(ns)
    if (!locales) {
      locales = new Map()
      this.dicts.set(ns, locales)
    }
    for (const [locale] of pairs) {
      if (locales.has(locale)) throw new Error(`locale namespace "${ns}" already has locale "${locale}"`)
    }
    for (const [locale, entries] of pairs) locales.set(locale, entries)
    this.publish(this.snapshot.active, false) // 注册升 revision，不发 locale/change
    return () => {
      const owner = this.dicts.get(ns)
      /* v8 ignore next -- defensive: a namespace's locales map is created on
       * first register and never removed, so the disposer always finds it. */
      if (!owner) return
      let removed = false
      for (const [locale, entries] of pairs) {
        if (owner.get(locale) === entries) {
          owner.delete(locale)
          removed = true
        }
      }
      if (removed) this.publish(this.snapshot.active, false)
    }
  }

  /**
   * Bind a declared namespace to a translate function typed to its
   * dictionary key union (plus the shared common vocabulary) — the same key
   * domain the framework-injected `t` seat carries. The returned reference
   * is stable per namespace (repeat binds return the same function), so it
   * can ride inject surfaces without breaking memoization.
   * @param ns - a namespace merged into LocaleNamespaceMap.
   * @returns the typed translate function (reads the active locale at call time).
   */
  /*
   * 把声明命名空间绑定到按其字典键联合类型化的翻译函数（加共享公共
   * 词汇）——与框架注入 t 座位携带的键域相同。返回引用按命名空间稳定
   * （重复 bind 返回同一函数），因此可乘注入面而不破坏记忆化。
   * @param ns 已合并进 LocaleNamespaceMap 的命名空间。
   * @returns 类型化翻译函数（调用时读取激活语言）。
   */
  bind<N extends keyof LocaleNamespaceMap & string>(ns: N): TranslateNS<N>
  /**
   * Untyped form for namespaces outside the merge table (dynamic
   * composition, tests).
   * @param ns - namespace.
   * @returns the translate function.
   */
  /*
   * 合并表外命名空间（动态组合、测试）的无类型形式。
   * @param ns 命名空间。
   * @returns 翻译函数。
   */
  bind(ns: string): Translate
  bind(ns: string): Translate {
    let t = this.bound.get(ns)
    if (!t) {
      t = (key, params) => this.translate(ns, key, params)
      this.bound.set(ns, t)
      return t
    }
    return t
  }

  /** 解析单键：条目命名空间（激活/回退）-> common 命名空间 -> 键本身；占位符替换。 */
  private translate(ns: string, key: string, params?: Record<string, unknown>): string {
    const template = this.lookup(ns, key)
      ?? (ns !== COMMON_NS ? this.lookup(COMMON_NS, key) : undefined)
      ?? key
    if (!params) return template
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in params ? String(params[name]) : match)
  }

  /** 查找链：激活语言 -> en 回退。 */
  private lookup(ns: string, key: string): string | undefined {
    const locales = this.dicts.get(ns)
    return locales?.get(this.snapshot.active)?.[key] ?? locales?.get(FALLBACK_LOCALE)?.[key]
  }

  /**
   * Advance the snapshot revision and notify LocaleFace subscribers (render
   * refresh). Only an active-locale switch additionally emits
   * `locale/change` — dictionary registrations stay off the event so
   * registration-heavy boot cannot storm event listeners (which may
   * re-register slots in response).
   */
  /*
   * 推进快照修订号并通知 LocaleFace 订阅者（渲染刷新）。只有激活语言切换
   * 才额外发射 locale/change——字典注册保持离线事件，使注册密集的启动
   * 不会风暴事件监听器（它们可能响应式重新注册槽位）。
   */
  private publish(active: LocaleId, localeChanged: boolean): void {
    this.snapshot = Object.freeze({
      active,
      locales: this.snapshot.locales,
      revision: this.snapshot.revision + 1,
    })
    if (localeChanged) this.ctx.emit('locale/change', this.snapshot)
    for (const fn of [...this.listeners]) {
      try {
        fn()
      } catch (error) {
        // One throwing subscriber must not strand the rest on a stale
        // revision (outlets would keep the previous language).
        // 一个抛错订阅者不得让其余订阅者搁浅在陈旧修订号上（输出口会保持
        // 上一语言）。
        console.error('locale subscriber crashed:', error)
      }
    }
  }
}

/**
 * The browser's own language wins over {@link FALLBACK_LOCALE}; an explicit
 * Host preference may replace this provisional value after plugin activation.
 */
/*
 * 浏览器自身语言优先于 FALLBACK_LOCALE；显式 Host 偏好可在插件激活后替换
 * 该临时值。
 */
function resolveInitialLocale(): LocaleId {
  return detectBrowserLocale() ?? FALLBACK_LOCALE
}

/**
 * The first shipped locale the browser asks for, matched on the primary
 * subtag so every regional variant lands on its language (`zh-Hans-CN` -> zh,
 * `en-GB` -> en). `window` is the browser test, not `navigator`: Node exposes
 * a global `navigator` reporting the machine's own language, which would
 * otherwise decide the locale for non-browser runs (node e2e booting the
 * client tree). `navigator.language` trails the ordered `languages` list and
 * covers its absence on hosts that expose only the single tag.
 */
/*
 * 浏览器要求的第一个发货语言，按主子标签匹配，使每个地区变体落到其语言
 * （zh-Hans-CN -> zh，en-GB -> en）。用 window 做浏览器测试而非 navigator：
 * Node 暴露报告机器自身语言的全局 navigator，否则会为非浏览器运行
 * （启动客户端树的 node e2e）决定语言。navigator.language 跟在有序
 * languages 列表之后，覆盖只暴露单标签的宿主上该列表的缺失。
 */
function detectBrowserLocale(): LocaleId | undefined {
  if (typeof window === 'undefined') return undefined
  /* oxlint 禁用说明：DOM lib 把 languages 类型化为总是存在；嵌入器与旧
   * WebView 的 Navigator 没有它，展开 undefined 会在启动时抛错。*/
  /* oxlint-disable-next-line typescript/no-unnecessary-condition --
   * The DOM lib types `languages` as always present; embedders and older
   * WebViews ship a Navigator without it, and spreading undefined would
   * throw at boot. */
  for (const tag of [...(navigator.languages ?? []), navigator.language]) {
    const primary = tag.toLowerCase().split('-')[0]
    const match = LOCALES.find(locale => locale.id === primary)
    if (match) return match.id
  }
  return undefined
}

/** Required services: slot registration plus the settings transport. */
/* 必需服务：槽位注册 + 设置传输。 */
export const inject = ['slots', 'connection', 'remote', 'settingsScope']

/**
 * Client plugin body: provide the locale service with base dictionaries and
 * register the feature-owned Language preference row into the General
 * section's item slot (a feature owns its settings surface).
 * @param ctx - client cordis context.
 */
/*
 * 客户端插件体：提供服务（带基础字典）并把功能自有的"语言"偏好行注册进
 * General 段的 item 槽位（功能拥有其设置面）。
 * @param ctx 客户端 cordis 上下文。
 */
export function apply(ctx: ClientContext): void {
  const host = ctx.settingsScope.bind<LocaleSettings>({ namespace: LOCALE_SETTINGS_NAMESPACE })
  const locale = new LocaleRuntime(ctx, host)
  locale.register(COMMON_NS, { zh, en })
  locale.register(SETTINGS_NS, { zh: settingsZh, en: settingsEn })
  ctx.provide('locale', locale)
  // The service IS the LocaleFace (bind + getSnapshot/subscribe): install it
  // so the render machinery can synthesize the `t` standard seat.
  // 服务本身就是 LocaleFace（bind + getSnapshot/subscribe）：安装它，使
  // 渲染机制可合成 t 标准座位。
  ctx.slots.installLocale(locale)

  const store = createLanguageRowStore()
  let bound: BoundActions<typeof store> | undefined
  const sync = (snapshot: LocaleSnapshot): void => {
    syncDocumentLanguage(snapshot.active)
    bound?.sync(
      snapshot.active,
      snapshot.locales.map(l => ({ id: l.id, label: l.label })),
      snapshot.revision,
    )
  }
  ctx.on('locale/change', sync)
  // The served markup declares one language; the resolved locale may differ
  // (browser detection, or a stored preference adopted after activation), so
  // state it once at activation rather than waiting for the first change.
  // 服务标记声明一种语言；解析出的语言可能不同（浏览器检测，或激活后
  // 采纳的存储偏好），因此在激活时声明一次，而非等首次变更。
  syncDocumentLanguage(locale.getLocale().active)
  const injected = (actions: BoundActions<typeof store>): LanguageRowInjected => {
    bound = actions
    // Re-sync from the getter so no event is lost between registration and
    // first render (the store's revision guard drops stale duplicates).
    // 从 getter 重新同步，使注册与首次渲染之间不丢事件（存储修订号守卫
    // 丢弃陈旧重复）。
    sync(locale.getLocale())
    return {
      setLocale: (id) => { locale.setLocale(id) },
    }
  }
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'language',
    order: 0,
    store,
    locale: SETTINGS_NS,
    inject: injected,
  }, LanguageRow))
}
