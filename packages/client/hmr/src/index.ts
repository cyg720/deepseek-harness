/**
 * ================================ 文件注释 ================================
 * 【文件职责】HMR 插件的节点半边：开发重载链的 Host 端——以 interval stat
 *   轮询每个图行客户端 bundle，经 clientModuleHost.rebuilt(id) 报告内容
 *   变化，并提供 /plugins/events SSE 通道广播 graph/rebuilt 帧。
 * 【技术维度】轮询而非 inotify（网络挂载不投递 inotify 事件）；stat 前后
 *   先比较 mtime/size 再哈希；与 clientModules 图订阅保持监视集合同步。
 * 【产品维度】开发模式下保存 bundle 即触发重建帧，浏览器半边据此热换；
 *   无重建监视器时轮询观察不到变化，链路保持空闲。
 * 【逻辑维度】watchRow/pollWatches/syncWatches 管轮询与集合差集；
 *   rehash 调用 rebuilt()（仅真 rev 变化静默）；connect 写 SSE 头与
 *   graph 帧；onRebuilt 广播 rebuilt 帧。
 * 【关键边界】监视器随 ctx.effect 生命周期（卸载清除）；脏位处理 ENOENT
 *   瞬时缺失；帧到达浏览器半边的 JSON 解析点仍须校验。
 * 【新手阅读建议】先读 events.ts 的线协议与 client/ 半边的重载顺序。
 * ==========================================================================
 */
/**
 * HMR plugin, node half: the host end of the dev reload chain. One interval
 * stat-polls every graph row's client bundle (polling by design: network mounts
 * deliver no inotify events), reports changes through
 * `clientModuleHost.rebuilt(id)`, and serves the `/plugins/events` SSE channel
 * broadcasting graph/rebuilt frames to the browser half (src/client/).
 * The web bundle mounts this row unconditionally: without a rebuild
 * watcher rewriting client bundles, the poll observes no changes and the
 * chain stays idle.
 */
/*
 * HMR 插件的节点半边：开发重载链的 Host 端。一个 interval 对每个图行的
 * 客户端 bundle 做 stat 轮询（刻意轮询：网络挂载不投递 inotify 事件），
 * 经 clientModuleHost.rebuilt(id) 报告内容变化，并服务 /plugins/events
 * SSE 通道向浏览器半边（src/client/）广播 graph/rebuilt 帧。web bundle
 * 无条件挂载本行：没有重建监视器重写客户端 bundle 时，轮询观察不到变化，
 * 链路保持空闲。
 */
import { statSync } from 'node:fs'
import type { ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Empty type imports carry the clientModuleHost/webServer Context merges.
import type { ClientArtifactBaseline } from '@deepseek-ai/dsh-client-modules'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { PluginsEventFrame } from './events.ts'
import { EVENTS_ENDPOINT } from './events.ts'

export type { PluginsEventFrame } from './events.ts'
export { EVENTS_ENDPOINT } from './events.ts'

/** Cordis plugin name. */
/* Cordis 插件名。 */
export const name = 'client-hmr'

/** Required services: the web plugin table and the route registry. */
/* 必需服务：web 插件表与路由注册表。 */
export const inject = ['clientModules', 'webServer']

/** Plugin config, validated by the same-named schemastery schema. */
/* 插件配置，由同名 schemastery schema 校验。 */
export interface Config {
  /** Bundle stat-poll interval in milliseconds (default 500, the build-side watcher's polling default). */
  /* bundle stat 轮询间隔毫秒数（默认 500，构建侧监视器的轮询默认值）。 */
  pollIntervalMs?: number
}

export const Config: z<Config> = z.object({
  pollIntervalMs: z.number().step(1).min(1).default(500),
})

/** Serialize one frame as an SSE data line. */
/* 把一个帧序列化为 SSE data 行。 */
function sseData(frame: PluginsEventFrame): string {
  return `data: ${JSON.stringify(frame)}\n\n`
}

type WatchedBundleStat = Omit<ClientArtifactBaseline, 'path'>

type WatchedBundle = {
  -readonly [K in keyof ClientArtifactBaseline]: ClientArtifactBaseline[K]
} & { dirty: boolean }

/** Snapshot the executable bundle metadata that drives reloads. */
function bundleStat(path: string): WatchedBundleStat {
  const bundle = statSync(path)
  return { mtimeMs: bundle.mtimeMs, size: bundle.size }
}

/** Whether the executable bundle is unchanged since the last successful re-hash. */
function sameBundleStat(left: WatchedBundleStat, right: WatchedBundleStat): boolean {
  return left.mtimeMs === right.mtimeMs
    && left.size === right.size
}

/**
 * Mount the dev chain: bundle watches, rebuilt reporting, and the SSE channel.
 * @param ctx - host plugin context carrying clientModuleHost and webServer.
 * @param config - validated {@link Config}.
 */
/*
 * 挂载开发链：bundle 监视、重建报告与 SSE 通道。
 * @param ctx 携带 clientModuleHost 与 webServer 的 Host 插件上下文。
 * @param config 已校验的 Config。
 */
export function apply(ctx: Context, config: Config): void {
  // schemastery's .default() guarantees the field is set after validation.
  // schemastery 的 .default() 保证校验后该字段已设置。
  const pollIntervalMs = config.pollIntervalMs as number

  // --- bundle watch: one HMR-owned stat poll ------------------------------
  // --- bundle 监视：一个 HMR 自有的 stat 轮询 -----------------------------
  const watched = new Map<string, WatchedBundle>()

  const rehash = (id: string, watch: WatchedBundle, current: WatchedBundleStat): void => {
    try {
      // rebuilt() replaces the opaque startup rev on its first call; later
      // calls stay silent when the content hash is unchanged.
      ctx.clientModules.rebuilt(id)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        watch.dirty = true // 文件瞬时缺失：置脏位，恢复后重哈希
        return
      }
      ctx.logger.warn(error)
    }
    watch.mtimeMs = current.mtimeMs
    watch.size = current.size
    watch.dirty = false
  }

  const watchRow = (id: string, baseline: ClientArtifactBaseline): void => {
    const watch: WatchedBundle = { ...baseline, dirty: false }
    watched.set(id, watch)
    let current: WatchedBundleStat
    try {
      current = bundleStat(baseline.path)
    } catch (error) {
      watch.dirty = true
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') ctx.logger.warn(error)
      return
    }
    // The module host captured its baseline before reading the bytes in the
    // startup batch. Only a mismatch crosses into the content-hash path.
    if (!sameBundleStat(current, watch)) rehash(id, watch, current)
  }

  /** 每轮轮询：stat 变化或脏位时重哈希。 */
  const pollWatches = (): void => {
    for (const [id, watch] of watched) {
      let current: WatchedBundleStat
      try {
        current = bundleStat(watch.path)
      } catch (error) {
        watch.dirty = true
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') ctx.logger.warn(error)
        continue
      }
      if (!watch.dirty && sameBundleStat(current, watch)) continue
      // Stat-before-hash preserves a detectable older baseline for writes that
      // land during hashing. Repeated stat changes heal a torn read.
      // stat 先于哈希，为哈希期间落地的写入保留可检测的较旧基线；重复的
      // stat 变化会治愈撕裂读。
      rehash(id, watch, current)
    }
  }

  // Diff the watch set against the current graph: drop watches for removed
  // rows (or rows whose bundle path moved), add watches for new rows.
  // 把监视集合与当前图做差集：移除已删行（或 bundle 路径移动的行）的
  // 监视，为新增行添加监视。
  const syncWatches = (): void => {
    const rows = new Map<string, ClientArtifactBaseline>()
    for (const row of ctx.clientModules.graph().entries) {
      const watch = ctx.clientModules.artifactBaseline(row.id)
      if (watch !== undefined) rows.set(row.id, watch)
    }
    for (const [id, watch] of watched) {
      if (rows.get(id)?.path === watch.path) continue
      watched.delete(id)
    }
    for (const [id, watch] of rows) {
      if (!watched.has(id)) watchRow(id, watch)
    }
  }

  ctx.effect(() => {
    // Initial sync covers rows already in the graph; the subscription covers
    // rows arriving later (boot-window activations, including this plugin's
    // own row — no self-exemption, a modules/hmr rebuild rides the same chain).
    // 初始同步覆盖已在图中的行；订阅覆盖之后到达的行（启动窗口激活，
    // 含本插件自己的行——无自我豁免，modules/hmr 重建走同一条链）。
    syncWatches()
    const unsubscribe = ctx.clientModules.onGraphChanged(syncWatches)
    const timer = setInterval(pollWatches, pollIntervalMs)
    timer.unref()
    return () => {
      unsubscribe()
      clearInterval(timer)
      watched.clear()
    }
  }, 'client-hmr: bundle watches')

  // --- /plugins/events SSE channel ----------------------------------------
  // --- /plugins/events SSE 通道 --------------------------------------------
  const connections = new Set<ServerResponse>()

  /** 建立一条 SSE 连接：写头、注释行、graph 帧；关闭时从集合移除。 */
  const connect = (res: ServerResponse): void => {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'connection': 'keep-alive',
    })
    // Comment line on open so clients/proxies see a live channel even when
    // no rebuild ever happens; EventSource frame parsing skips it naturally.
    // 打开时写注释行，使客户端/代理即使从未重建也看到活跃通道；
    // EventSource 帧解析会自然跳过它。
    res.write(': connected\n\n')
    res.write(sseData({ type: 'graph', graph: ctx.clientModules.graph() }))
    connections.add(res)
    res.on('close', () => { connections.delete(res) })
  }

  ctx.effect(() => {
    const disposeRoute = ctx.webServer.register({
      kind: 'exact',
      path: EVENTS_ENDPOINT,
      handler: (req, res) => {
        // Named routes match ahead of the carrier's method gate; keep the old
        // global 405 semantics for non-GET hits on this endpoint.
        // 命名路由先于载体的方法门匹配；对本端点的非 GET 命中保持旧的
        // 全局 405 语义。
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405)
          res.end()
          return
        }
        connect(res)
      },
    })
    const unsubscribe = ctx.clientModules.onRebuilt((id, rev) => {
      const line = sseData({ type: 'rebuilt', id, rev })
      for (const res of connections) res.write(line)
    })
    return () => {
      unsubscribe()
      disposeRoute()
      for (const res of connections) res.destroy()
      connections.clear()
    }
  }, 'client-hmr: /plugins/events channel')
}
