/*
 * ================================ 文件注释 ================================
 * 【文件职责】CommandUiRuntime（ctx.commandUi）：'/' 命令源的总控服务——按会话的命令
 *             目录缓存、客户端贡献注册表、命令装饰注册表、每个会话的弹出选择控制器，
 *             以及候选合成（模糊匹配）与执行事务。
 * 【技术维度】Cordis Service：static inject 声明依赖；在构造函数里注册 '/' 输入源、
 *             监听 commands/change 与 agent-preset/selected 事件失效目录；register/decorate
 *             用 ctx.effect 提供生命周期；dispatch/matchSpace/matchEnter 构成"决策表"。
 * 【产品维度】敲 / 弹命令菜单、空格补全参数、回车执行；宿主命令/客户端贡献/装饰命令
 *             三类入口统一裁决；执行结果以持久流程节点渲染。
 * 【逻辑维度】candidates 合成菜单候选 → dispatch 裁决菜单选择 → matchEnter 裁决回车
 *             → execute 提交宿主执行事务 → 结果经 notifyExecuted 发本地事件。
 * 【关键边界】候选合成中贡献与宿主命令重名会报错；装饰只作用于可解析的宿主命令；
 *             带图片的提交只允许声明接受图片的命令，其余路径一律拒绝且保留草稿。
 * 【新手阅读建议】先看目录/契约/弹窗三个伴生文件，再沿 candidates → matchEnter → execute 读主流程。
 * ==========================================================================
 */
/**
 * CommandUiRuntime (`ctx.commandUi`): the '/' command source over the
 * session-keyed directory, the client-contribution registry, and the
 * per-session popupSelect controllers. Candidate synthesis merges the host
 * catalog with contributions by availability, then fuzzy query/position
 * filtering; a host/contribution name collision fails loud. Every execute
 * addresses the session's agent by sessionId — sessions are always
 * agent-backed.
 */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.remote merge and the forwarded-event key face
// (`commands/change` rides the allowlist) into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { CommandResult } from '@deepseek-ai/dsh-commands/types'
import type { ClientContext, ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type {
  CandidateRequest, ClientSessionContext, CommandClaim, PickOutcome, InputTriggerCandidate, InputTriggerPick,
  SubmitEnvelope, SubmitImageAttachment, SubmitOutcome,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { CommandContribution, CommandDecoration, CommandUiContract } from './contract.ts'
import type { CommandDescriptor } from './directory.ts'
import { CommandDirectory } from './directory.ts'
import { PopupSelectController } from './popup.ts'
import type { TokenSegment } from './popup.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * This browser client completed one admitted Host command execution.
     * Other clients receive the durable command nodes but never this local
     * submission acknowledgment.
     * @param sessionId - Session addressed by the local submission.
     * @param name - Executed command name without the leading slash.
     * @param result - Host command result returned to this browser.
     * @mode emit
     */
    'command/executed'(sessionId: SessionId, name: string, result: CommandResult): void
  }
}

/** Recover the command name from a line the Host confirmed as executed. */
// 从宿主确认执行的整行文本中取出命令名（去掉前导斜杠与参数部分）。
function submittedCommandName(line: string): string {
  const trimmed = line.trim()
  const separator = trimmed.search(/\s/u)
  return (separator === -1 ? trimmed : trimmed.slice(0, separator)).slice(1)
}

/** Live mutable state in one holder (service methods run behind the caller-ctx tracker). */
// 服务运行期的全部可变状态：贡献表、装饰表与按会话的弹窗控制器表。
interface LiveState {
  readonly contributions: Map<string, CommandContribution>
  readonly decorations: Map<string, CommandDecoration>
  readonly popups: Map<SessionId, PopupSelectController<ClientSessionContext>>
}

/** One fuzzy match with its stable source position. */
// 一次模糊匹配的结果：候选本身、其在原始列表中的位置、是否为前缀匹配与得分。
interface RankedCandidate {
  readonly candidate: InputTriggerCandidate
  readonly index: number
  readonly prefix: boolean
  readonly score: number
}

/** Extra weight for command-name starts and separator boundaries. */
// 模糊匹配的边界加分：命中名字开头或 '-'/'_' 分隔处时额外加权，让命名边界更易命中。
function boundaryBonus(name: string, index: number): number {
  return index === 0 || name.charAt(index - 1) === '-' || name.charAt(index - 1) === '_' ? 8 : 0
}

/**
 * Score the strongest ordered-subsequence alignment in O(name × query).
 * Boundary and adjacent matches earn weight; skipped and leading characters
 * cost weight.
 */
// 计算名字对查询的模糊匹配得分（最长有序子序列动态规划）：
// 边界/相邻命中加分，跳字与开头未命中扣分；无匹配时返回 undefined。
function fuzzyScore(name: string, query: string): number | undefined {
  if (query === '') return 0
  if (query.length > name.length) return undefined
  const noMatch = Number.NEGATIVE_INFINITY
  let previous = Array<number>(name.length).fill(noMatch)
  for (let index = 0; index < name.length; index++) {
    if (name.charAt(index) === query.charAt(0)) previous[index] = 1 + boundaryBonus(name, index) - index
  }
  for (let queryIndex = 1; queryIndex < query.length; queryIndex++) {
    const current = Array<number>(name.length).fill(noMatch)
    let bestGapped = noMatch
    for (let index = 0; index < name.length; index++) {
      const gappedIndex = index - 2
      if (gappedIndex >= 0) {
        const prior = previous[gappedIndex] ?? noMatch
        if (prior !== noMatch) bestGapped = Math.max(bestGapped, prior + gappedIndex)
      }
      if (name.charAt(index) !== query.charAt(queryIndex)) continue
      const bonus = 1 + boundaryBonus(name, index)
      const adjacent = index > 0 ? previous[index - 1] ?? noMatch : noMatch
      if (adjacent !== noMatch) current[index] = adjacent + bonus + 4
      if (bestGapped !== noMatch) current[index] = Math.max(current[index] ?? noMatch, bestGapped + bonus + 1 - index)
    }
    previous = current
  }
  let best = noMatch
  for (const score of previous) best = Math.max(best, score)
  return best === noMatch ? undefined : best
}

/** Case-insensitive fuzzy filtering with stable ordering for equal matches. */
// 不区分大小写的模糊过滤：空查询返回全部；否则按得分排序，前缀命中优先，同分按原顺序。
function fuzzyCandidates(candidates: readonly InputTriggerCandidate[], rawQuery: string): readonly InputTriggerCandidate[] {
  const query = rawQuery.toLowerCase()
  if (query === '') return candidates
  const ranked: RankedCandidate[] = []
  candidates.forEach((candidate, index) => {
    const name = candidate.name.toLowerCase()
    const score = fuzzyScore(name, query)
    if (score !== undefined) ranked.push({ candidate, index, prefix: name.startsWith(query), score })
  })
  ranked.sort((left, right) =>
    Number(right.prefix) - Number(left.prefix) || right.score - left.score || left.index - right.index)
  return ranked.map(match => match.candidate)
}

/** Command surface: session-keyed directory + '/' source + contribution registry + per-session popups. */
// 命令表面服务：会话键控目录 + '/' 输入源 + 贡献/装饰注册表 + 每会话弹窗。
export class CommandUiRuntime extends Service implements CommandUiContract {
  static inject = ['inputTriggers', 'sessions', 'remote', 'remote.commands']

  private readonly directory: CommandDirectory
  private readonly live: LiveState = { contributions: new Map(), decorations: new Map(), popups: new Map() }
  /** `command`-namespace translator (composer refusal notices). */
  private readonly t: TranslateNS<'command'>

  /**
   * @param ctx - owning root context (plugin fiber; the service registers
   * itself as `command` and follows that fiber's lifetime).
   */
  constructor(ctx: Context) {
    super(ctx, 'commandUi')
    const locale = ctx.get('locale')
    if (locale === undefined) throw new Error('ui-commands: locale service unavailable')
    this.t = locale.bind('command')
    this.directory = new CommandDirectory(async (sessionId) => {
      if (this.sessions().subagentAddress(sessionId) !== undefined) return []
      const result = await ctx.remote.commands.list(sessionId)
      if (!result.ok) throw new Error(`command.list failed: ${result.error.code}: ${result.error.message}`)
      return result.value
    })
    const inputTriggers = ctx.get('inputTriggers')
    if (inputTriggers === undefined) throw new Error('ui-commands: slash service unavailable')
    ctx.effect(() => inputTriggers.registerSource({
      trigger: '/',
      name: 'command',
      candidates: (session, req) => this.candidates(session, req),
      onPick: pick => this.dispatch(pick),
      matchSpace: (session, token) => this.matchSpace(session, token),
      matchEnter: (session, line, signal, envelope) => this.matchEnter(session, line, signal, envelope),
      warm: (session) => { this.directory.warm(session.sessionId) },
    }), 'command: slash source')
    ctx.remote.$on('commands/change', () => { this.directory.invalidateAll() })
    // A preset switch changes which commands one session's agent resolves and
    // registers nothing globally, so the registry-wide signal above never
    // fires for it: repull that key alone, soft, so the old snapshot serves
    // the menu until the new one lands.
    ctx.remote.$on('agent-preset/selected', (sessionId) => { void this.directory.refresh(sessionId) })
    ctx.on('connection/reset', () => { this.directory.resetConnected() })
  }

  /**
   * Register one client command contribution; effect disposer (rides the
   * caller's fiber). Duplicate names throw.
   * @param contribution - the contribution (descriptor + availability + popup spec).
   * @returns the disposer removing the registration.
   */
  // 注册一个客户端命令贡献：随调用方 fiber 生效；重名直接抛错。
  register(contribution: CommandContribution): () => void {
    const dispose = this.ctx.effect(() => {
      const { contributions } = this.live
      if (contributions.has(contribution.name)) {
        throw new Error(`ui-commands: duplicate contribution for /${contribution.name}`)
      }
      contributions.set(contribution.name, contribution)
      return () => { contributions.delete(contribution.name) }
    }, 'command.register()')
    return () => { void dispose() }
  }

  /**
   * Hang a bare-invocation decoration on one host command; effect disposer
   * (rides the caller's fiber). Duplicate names throw.
   * @param decoration - host command name + availability + popup spec.
   * @returns the disposer removing the registration.
   */
  // 给宿主命令挂一个裸调用装饰：随调用方 fiber 生效；重名直接抛错。
  decorate(decoration: CommandDecoration): () => void {
    const dispose = this.ctx.effect(() => {
      const { decorations } = this.live
      if (decorations.has(decoration.name)) {
        throw new Error(`ui-commands: duplicate decoration for /${decoration.name}`)
      }
      decorations.set(decoration.name, decoration)
      return () => { decorations.delete(decoration.name) }
    }, 'command.decorate()')
    return () => { void dispose() }
  }

  /**
   * Resolve the per-session popup controller (lazy; dies with the session
   * scope). The controller's consume callback dispatches the scoped
   * consume-token event back to this session; focusComposer reaches the
   * composer through the overlay slot currency.
   * @param actx - session-scope ctx.
   * @returns the resident controller.
   */
  popupFor(actx: ClientContext): PopupSelectController<ClientSessionContext> {
    const sessions = this.sessions()
    const id = sessions.scopeOf(actx)
    if (id === undefined) throw new Error('command.popupFor requires a session scope')
    const { popups } = this.live
    const existing = popups.get(id)
    if (existing !== undefined) return existing
    const controller = new PopupSelectController<ClientSessionContext>({
      consume: segment => actx.bail(actx, 'slash/input-consume-token', {
        guard: segment.via === 'menu'
          ? { kind: 'span', span: segment.span }
          : { kind: 'bare-token', token: segment.token },
      }) === true,
      focusComposer: () => { this.focusHooks.get(id)?.() },
    })
    popups.set(id, controller)
    actx.effect(() => () => {
      controller.dispose()
      popups.delete(id)
      this.focusHooks.delete(id)
    }, 'command: session popup')
    return controller
  }

  /** Composer focus hooks by session (the overlay wiring binds the textarea focus here). */
  private readonly focusHooks = new Map<SessionId, () => void>()

  /**
   * Bind one session's composer-focus hook (overlay slot wiring; unbind on unmount).
   * @param id - session id.
   * @param focus - textarea focus callback.
   * @returns the unbind disposer.
   */
  bindComposerFocus(id: SessionId, focus: () => void): () => void {
    this.focusHooks.set(id, focus)
    return () => {
      if (this.focusHooks.get(id) === focus) this.focusHooks.delete(id)
    }
  }

  /** Menu candidates: host catalog + contribution availability, then position filtering and fuzzy name ranking. */
  // 菜单候选合成：合并宿主目录与可用贡献（重名报错），再做位置过滤与模糊排序。
  private async candidates(session: ClientSessionContext, req: CandidateRequest): Promise<readonly InputTriggerCandidate[]> {
    const list = await this.directory.ensureReady(session.sessionId, req.signal)
    const rows: InputTriggerCandidate[] = []
    const seen = new Set<string>()
    for (const c of list) {
      seen.add(c.name)
      rows.push({ name: c.name, description: c.description, ...(c.input !== undefined ? { hint: c.input.hint } : {}) })
    }
    for (const contribution of this.live.contributions.values()) {
      if (!contribution.available(session)) continue
      if (seen.has(contribution.name)) {
        throw new Error(`ui-commands: contribution /${contribution.name} collides with a host command`)
      }
      rows.push({ name: contribution.name, description: contribution.description })
    }
    return fuzzyCandidates(
      rows.filter(c => req.position === 'leading' || c.hint === undefined),
      req.query,
    )
  }

  /** Decision table, menu column: contribution/decorated-host → popup; host input → claim; host bare → detached execute. */
  // 菜单列的裁决表：贡献/被装饰宿主命令 → 打开弹窗；宿主带参命令 → 返回参数声明；
  // 宿主裸命令 → 消费 token 并分离执行。
  private dispatch(pick: InputTriggerPick): PickOutcome {
    const name = pick.candidate.name
    const contribution = this.live.contributions.get(name)
    if (contribution !== undefined && contribution.available(pick.session)) {
      this.openPopup(name, contribution.ui, pick.session, { via: 'menu', span: pick.span })
      return 'handled'
    }
    const desc = this.directory.resolve(pick.session.sessionId, name)
    if (desc === undefined) return undefined // snapshot swapped between menu and pick → miss
    // A decoration replaces the HOST row's bare invocation with its popup;
    // it decorates only a resolvable host command (checked above), never
    // manufactures one, and never touches the argument claim below.
    const decoration = this.live.decorations.get(name)
    if (decoration !== undefined && decoration.available(pick.session)) {
      this.openPopup(name, decoration.ui, pick.session, { via: 'menu', span: pick.span })
      return 'handled'
    }
    if (desc.input !== undefined) return { claim: this.leadingClaim(desc, pick.session) }
    // Menu-pick execute consumes the trigger span before the detached run
    // (scoped event; the input owns the CAS guard).
    this.consumeVia(pick.session.sessionId, { via: 'menu', span: pick.span })
    this.runDetached(desc, pick.session, `/${name}`)
    return 'handled'
  }

  /** Decision table, space column: hot-key sync check; only host leadingInput claims. */
  // 空格列的裁决表：同步检查；只有宿主的带参命令会声明参数（弹窗类永不声明）。
  private matchSpace(session: ClientSessionContext, token: string): PickOutcome {
    if (!token.startsWith('/')) return undefined
    const name = token.slice(1)
    if (this.live.contributions.has(name)) return undefined // popup kinds never claim on space
    const desc = this.directory.resolve(session.sessionId, name)
    if (desc === undefined || desc.input === undefined) return undefined
    return { claim: this.leadingClaim(desc, session) }
  }

  /**
   * Decision table, enter column. Strong-waits the session's catalog (a
   * warmup failure rejects — never a silent downgrade). Contributions and
   * bare host commands act on the bare token only; leadingInput claims
   * args-tolerant.
   *
   * Envelope policy: an enter submission carrying images resolves only
   * through a command declaring image acceptance. Every other command route —
   * popup, non-accepting claim, bare detached execute — throws the refusal
   * so the machine surfaces one composer notice and the draft and images
   * stay in place; nothing executes and nothing is dropped.
   */
  // 回车列的裁决表：强等待目录后判定贡献/装饰/带参声明/裸执行四类路径；
  // 携带图片时只有声明接受图片的命令才放行，其余一律拒绝且保留草稿与图片。
  private async matchEnter(
    session: ClientSessionContext,
    line: string,
    signal: AbortSignal,
    envelope: SubmitEnvelope,
  ): Promise<PickOutcome> {
    const trimmed = line.trim()
    if (!trimmed.startsWith('/')) return undefined
    const ws = trimmed.search(/\s/)
    const token = ws === -1 ? trimmed : trimmed.slice(0, ws)
    const bare = ws === -1
    const name = token.slice(1)
    if (name === '') return undefined
    const refuseImages = (): never => {
      throw new Error(this.t('notice.imagesUnsupported', { command: name }))
    }
    const contribution = this.live.contributions.get(name)
    if (contribution !== undefined && contribution.available(session)) {
      if (!bare) return undefined
      if (envelope.images > 0) refuseImages()
      this.openPopup(name, contribution.ui, session, { via: 'enter', token })
      return 'handled'
    }
    await this.directory.ensureReady(session.sessionId, signal)
    const desc = this.directory.resolve(session.sessionId, name)
    if (desc === undefined) return undefined
    // Bare enter on a decorated host command opens its popup; an argued line
    // never consults the decoration (the claim/detached paths below own it).
    if (bare) {
      const decoration = this.live.decorations.get(name)
      if (decoration !== undefined && decoration.available(session)) {
        if (envelope.images > 0) refuseImages()
        this.openPopup(name, decoration.ui, session, { via: 'enter', token })
        return 'handled'
      }
    }
    if (desc.input !== undefined) {
      if (envelope.images > 0 && desc.input.images !== true) refuseImages()
      return { claim: this.leadingClaim(desc, session) }
    }
    if (!bare) return undefined
    if (envelope.images > 0) refuseImages()
    this.consumeVia(session.sessionId, { via: 'enter', token })
    this.runDetached(desc, session, trimmed)
    return 'handled'
  }

  /** Open the session's popup for one contribution or decoration (menu pick / bare enter). */
  private openPopup(
    name: string,
    ui: CommandContribution['ui'],
    session: ClientSessionContext,
    segment: TokenSegment,
  ): void {
    const actx = this.scopeFor(session.sessionId)
    if (actx === undefined) return
    this.popupFor(actx).open(name, ui, session, segment)
  }

  /** Build the leadingInput claim: token `/name ` + the command.execute submit transaction. */
  private leadingClaim(desc: CommandDescriptor, session: ClientSessionContext): CommandClaim {
    const token = `/${desc.name} `
    return {
      token,
      ...(desc.input !== undefined ? { hint: desc.input.hint } : {}),
      ...(desc.input?.images === true ? { images: true } : {}),
      submit: (args, _actx, images) => this.execute(session, token + args, images),
    }
  }

  /**
   * The command.execute transaction, addressed to the session's agent — pure
   * admission semantics. An unmatched line reports an error outcome (the
   * composer's immediate admission feedback); an admitted command reports
   * plain success regardless of its handler outcome, because the host
   * executor durably logged the lifecycle (`command/run`/`command/done`) and
   * the outcome renders as a persistent flow node — the composer never
   * echoes it. A handler error result reports an error outcome so the
   * composer keeps the submission (draft and images) for correction.
   * Transport failures throw.
   */
  // command.execute 事务：未匹配命令报错误结果（输入框即时反馈）；已受理命令无论
  // 处理器成败都报成功（生命周期已持久化，以流程节点呈现）；处理器错误结果保留草稿。
  private async execute(
    session: ClientSessionContext,
    line: string,
    images: readonly SubmitImageAttachment[] = [],
  ): Promise<SubmitOutcome> {
    const result = await this.ctx.remote.commands.execute(session.sessionId, line, images)
    if (!result.ok) throw new Error(`command.execute failed: ${result.error.code}: ${result.error.message}`)
    if (result.value === undefined) return { kind: 'error', text: `unknown or malformed command: ${line}` }
    this.notifyExecuted(session.sessionId, submittedCommandName(line), result.value.result)
    // An image-carrying submission consumed its images only on handler
    // success; an error outcome keeps draft and images in the composer.
    if (images.length > 0 && result.value.result.kind === 'error') {
      return { kind: 'error', text: result.value.result.text }
    }
    return { kind: 'success' }
  }

  /** Publish the local acknowledgment without letting an observer change command admission. */
  private notifyExecuted(sessionId: SessionId, name: string, result: CommandResult): void {
    const args = ['command/executed', sessionId, name, result]
    for (const listener of this.ctx.events.dispatch('emit', args) as Array<(...listenerArgs: unknown[]) => unknown>) {
      try {
        const returned = listener(sessionId, name, result)
        if (returned != null && typeof (returned as PromiseLike<unknown>).then === 'function') {
          void Promise.resolve(returned as PromiseLike<unknown>).then(undefined, (error: unknown) => {
            this.warnExecutedListenerFailure(name, error)
          })
        }
      } catch (error) {
        this.warnExecutedListenerFailure(name, error)
      }
    }
  }

  /** Log one contained `command/executed` observer failure. */
  private warnExecutedListenerFailure(name: string, error: unknown): void {
    this.ctx.logger.warn('client command: a command/executed listener for "%s" failed', name)
    this.ctx.logger.warn(error)
  }

  /**
   * Fire-and-forget execute for the internal ('handled') paths. Outcomes are
   * NOT surfaced here: the host executor durably logs the command lifecycle
   * (`command/run`/`command/done`), and the mux-broadcast events render as a
   * persistent flow node on every tab. Only a transport/admission failure —
   * which never entered a handler and therefore never logged — falls back to
   * the composer notice as immediate feedback.
   */
  private runDetached(desc: CommandDescriptor, session: ClientSessionContext, line: string): void {
    void this.execute(session, line).then(
      (outcome) => {
        // matched:false maps to an error outcome with no logged lifecycle.
        if (outcome.kind === 'error') this.noticeFor(session.sessionId, 'error', outcome.text ?? `/${desc.name} failed`)
      },
      (error: unknown) => {
        this.noticeFor(session.sessionId, 'error', error instanceof Error ? error.message : String(error))
      },
    )
  }

  /** Dispatch a consume-token event to one session (menu-pick / bare-enter execute paths). */
  private consumeVia(id: SessionId, segment: TokenSegment): void {
    const actx = this.scopeFor(id)
    if (actx === undefined) return
    actx.bail(actx, 'slash/input-consume-token', {
      guard: segment.via === 'menu'
        ? { kind: 'span', span: segment.span }
        : { kind: 'bare-token', token: segment.token },
    })
  }

  /** Route an admission/transport failure to the session's composer notice channel (scope gone = attempt died with it). */
  private noticeFor(id: SessionId, level: 'info' | 'error', text: string): void {
    const actx = this.scopeFor(id)
    if (actx === undefined) return
    const conversation = actx.get('conversation')
    if (conversation === undefined) return
    conversation.input.for(actx).notify(level, text)
  }

  /** id → actx interchange (registered exchange point: this service coordinates for projection-only sources). */
  private scopeFor(id: SessionId): ClientContext | undefined {
    return this.sessions().scope(id)
  }

  private sessions(): ISessions {
    const sessions = this.ctx.get('sessions')
    if (sessions === undefined) throw new Error('ui-commands: sessions service unavailable')
    return sessions
  }
}
