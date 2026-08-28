// Web e2e scenario: the conversation column scrolls on one axis only, as the
// browser actually lays it out. The hazard: a horizontal scrollbar appears
// under the whole center column once the window (or the sidebar drag) narrows
// it — the hero's decorative backdrop ellipse bleeds past the column and
// becomes user-scrollable.
//
// The bleed is by construction and stays: `.heroGlow` is sized 1051/776 of the
// hero box (ConversationRoot.module.css) so the blur scales with the input
// card. The scroll container is where the bar comes from:
// `[data-conversation-scroll]` scrolls vertically, and a one-axis scroller
// computes the other axis's initial `visible` to `auto`, so the bleed becomes
// a bar; `overflow-x: hidden` on the scroller prevents it.
//
// Only a real engine reports that pair — the bleed and the resulting scroll
// range — so the scenario sweeps viewport widths that bracket the glow's
// width and asserts both at each stop. Asserting no horizontal scroll alone
// would go vacuous the moment the glow stopped bleeding for an unrelated
// reason, which is why each stop also records whether it bleeds; the wide stop
// is the control where it does not.
//
// Zero model calls: the hero is the boot state, so nothing is seeded and no
// replay row mounts. A stray stream would fail loud with NO_ADAPTER.
// 首页启动态不播种会话或回放；任何意外模型流都会以 NO_ADAPTER 失败。
/**
 * 文件职责：验证会话中心列只允许纵向滚动，装饰光晕横向溢出不会形成用户可滚动条。
 * 技术维度：使用 Playwright、真实浏览器滚动几何、视口宽度扫描和 overflow-x 变更对照。
 * 产品维度：窗口或侧栏缩窄时用户不会看到整列横向滚动条，同时纵向会话滚动仍可用。
 * 逻辑维度：扫描多个视口，记录光晕溢出与滚动范围，再强制 auto 作为对照并发送横向滚轮。
 * 关键边界：必须证明光晕确实越界以避免空洞断言；只记录关系和布尔值，不固定平台像素。
 * 新手阅读建议：先理解 glowBleeds 与 bleedRange 的区别，再看 wheelHorizontally 如何区分 hidden/auto。
 */
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/conversation-column-overflow', import.meta.url))
/**
 * Committed golden of the one-axis relation at every stop. It records
 * relations and booleans, never absolute coordinates: the column width follows
 * the viewport and the sidebar, and a golden carrying pixels would document the
 * platform instead of the behavior.
 */
/* 记录各宽度溢出关系与横向输入结果的几何黄金文件。 */
const GEOMETRY_EXPECTED = join(SNAPSHOT_DIR, 'geometry.expected.md')
/** 当前快照运行模式。 */
const MODE = webSnapshotMode()
/** Narrow sweep stop where the mutation control retains overflow across scrollbar implementations. */
/* 在不同滚动条实现下仍能保证对照溢出的窄视口宽度。 */
const CONTROL_VIEWPORT = 600
/**
 * Viewport widths bracketing the glow: the narrow stops retain the reported
 * bleed while the widest stop proves the relation can also be false.
 */
/* 从无溢出的宽视口到产生光晕溢出的窄视口扫描点。 */
const WIDTHS = [1680, 1200, 1000, 800, CONTROL_VIEWPORT]
/** Element id of the mutation control's injected sheet, so the test can take it back out. */
/* 强制横向 auto 的对照样式元素编号。 */
const CONTROL_STYLE_ID = 'dsh-column-overflow-control'
/** Horizontal wheel delta per gesture; must exceed the widest bleed the sweep can produce. */
/* 每次横向滚轮输入量，需大于扫描中最大溢出范围。 */
const WHEEL_DELTA = 300

/** One viewport stop: whether the glow bleeds past the column, and whether that bleed scrolls. */
/* 一个视口宽度下的中心列溢出、滚动范围和纵向能力。 */
interface ColumnMetrics {
  /** Viewport width the stop was measured at. */
  width: number
  /** The column's content width. Not committed to the golden — it is what settles after a resize, and what the sweep waits on. */
  columnWidth: number
  /** Resolved `overflow-x` on the conversation scroll container. */
  overflowX: string
  /**
   * True when the glow's box reaches past the column's content edge — the
   * condition the `overflow-x: hidden` declaration has to survive.
   */
  glowBleeds: boolean
  /**
   * `scrollWidth - clientWidth`. Deliberately NOT the assertion: `hidden` and
   * `auto` both report the same value, because `hidden` clips the bleed rather
   * than reflowing it away. Recorded because it is the vacuity guard in
   * numbers — it must stay positive at the narrow stops, or the scenario has
   * stopped reproducing the situation `overflow-x: hidden` exists for.
   */
  bleedRange: number
  /** True when the column still scrolls vertically — the axis `overflow-x: hidden` must not take away. */
  scrollsVertically: boolean
}

/**
 * Measure the conversation column at the page's current viewport.
 * @param page - the page under test.
 * @param width - the viewport width already applied, recorded with the reading.
 * @returns the stop's overflow relations.
 */
function measureColumn(page: Page, width: number): Promise<ColumnMetrics> {
  return page.evaluate((viewportWidth) => {
    /** 会话中心列滚动容器。 */
    const scroller = document.querySelector<HTMLElement>('[data-conversation-scroll]')
    if (scroller === null) throw new Error('conversation scroll container not in the DOM')
    /** 首页装饰光晕 SVG。 */
    const glow = scroller.querySelector<SVGElement>('[class*="heroGlow"]')
    if (glow === null) throw new Error('hero glow not in the DOM — the boot state is not the hero')
    /** 中心滚动容器与光晕的视口矩形。 */
    const box = scroller.getBoundingClientRect()
    /** 光晕的视口矩形。 */
    const glowBox = glow.getBoundingClientRect()
    return {
      width: viewportWidth,
      columnWidth: scroller.clientWidth,
      overflowX: getComputedStyle(scroller).overflowX,
      // `clientWidth` is the content edge, which is what the scrollable
      // overflow region is measured against; either side counts as a bleed,
      // though only the right one can produce a bar in this writing mode.
      // clientWidth 是滚动内容边缘；任一侧越界都算 bleed，当前书写方向只有右侧会产生条带。
      glowBleeds: glowBox.right > box.left + scroller.clientWidth + 0.5 || glowBox.left < box.left - 0.5,
      bleedRange: scroller.scrollWidth - scroller.clientWidth,
      scrollsVertically: getComputedStyle(scroller).overflowY === 'auto',
    }
  }, width)
}

/**
 * Scroll the column sideways the way a user would and report where it landed.
 *
 * This is the one signal that separates the two states, and it is why the
 * scenario needs a real engine: `overflow-x: hidden` leaves the box
 * programmatically scrollable and leaves `scrollWidth` untouched, so every
 * property reading agrees across the two overflow modes. Only refusing an
 * actual input event differs — measured at the 1200px stop, the shipped
 * column stays at 0 while the same page with `overflow-x: auto` forced on
 * lands at its scroll boundary.
 * @param page - the page under test.
 * @returns `scrollLeft` after one horizontal wheel over the column.
 */
async function wheelHorizontally(page: Page): Promise<number> {
  /** 避开嵌套编辑器滚动区的中心列输入坐标。 */
  const origin = await page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('[data-conversation-scroll]')
    if (scroller === null) throw new Error('conversation scroll container not in the DOM')
    // Start from the origin so the reading is this gesture's own effect.
    // 每次从零开始，使结果只反映当前滚轮手势。
    scroller.scrollLeft = 0
    /** 中心列滚动容器的视口矩形。 */
    const box = scroller.getBoundingClientRect()
    // Near the top of the column, clear of the centered hero card: the wheel
    // must reach the column, not a nested scroller the composer owns.
    // 坐标位于列顶部且避开编辑器，确保滚轮到达外层中心列。
    return { x: box.left + box.width / 2, y: box.top + 60 }
  })
  await page.mouse.move(origin.x, origin.y)
  await page.mouse.wheel(WHEEL_DELTA, 0)
  // A fixed settle, then two frames. Polling for a settled value cannot be
  // used here — the value under test is 0, which a poll starting at 0 accepts
  // before the gesture has had any chance to move it — so the wait is
  // generous enough to cover a smooth-scroll animation on any engine the lane
  // runs on. The timing is identical on both sides of the mutation control
  // below, which is what makes a 0 reading evidence rather than a race won.
  // 固定等待和两帧绘制避免从初始零值过早通过；对照两侧使用完全相同的时序。
  await page.waitForTimeout(400)
  return page.evaluate(() => new Promise<number>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve(document.querySelector<HTMLElement>('[data-conversation-scroll]')?.scrollLeft ?? -1)
      })
    })
  }))
}

/**
 * Measure the positive horizontal scroll boundary without changing the
 * shipped overflow mode. This is distinct from `scrollWidth - clientWidth`
 * when a stable scrollbar gutter leaves part of the overflow on the negative
 * side of the scroll origin.
 * @param page - the page under test.
 * @returns the greatest positive `scrollLeft` reachable by the control gesture.
 */
async function horizontalScrollLimit(page: Page): Promise<number> {
  return page.evaluate((delta) => {
    const scroller = document.querySelector<HTMLElement>('[data-conversation-scroll]')
    if (scroller === null) throw new Error('conversation scroll container not in the DOM')
    const previousScrollBehavior = scroller.style.scrollBehavior
    scroller.style.scrollBehavior = 'auto'
    scroller.scrollLeft = delta
    const limit = scroller.scrollLeft
    scroller.scrollLeft = 0
    scroller.style.scrollBehavior = previousScrollBehavior
    return limit
  }, WHEEL_DELTA)
}

/** A stop's readings plus where a horizontal wheel over it landed. */
type ColumnStop = ColumnMetrics & {
  /** `scrollLeft` after one horizontal wheel: the user-facing claim, 0 at every stop. */
  scrollLeftAfterWheel: number
}

/**
 * Render the golden body: one line per stop, relations only.
 *
 * Absolute pixels are deliberately absent apart from `scrollLeftAfterWheel`,
 * which the shipped overflow mode pins to 0 by construction. The bleed is
 * recorded as a boolean rather than its width, so the golden survives any
 * platform whose column lands a pixel off — a fixture that has to be
 * re-recorded per platform documents the platform, not the behavior.
 * @param stops - the measured stops, in sweep order.
 * @returns the golden body, without a trailing newline.
 */
function renderGeometry(stops: ColumnStop[]): string {
  return [
    '# Conversation column horizontal overflow',
    '',
    '| viewport | overflow-x | glow bleeds past the column | scrollLeft after a horizontal wheel | scrolls vertically |',
    '| --- | --- | --- | --- | --- |',
    ...stops.map(stop => `| ${String(stop.width)}px | ${stop.overflowX} | ${String(stop.glowBleeds)} `
      + `| ${String(stop.scrollLeftAfterWheel)}px | ${String(stop.scrollsVertically)} |`),
  ].join('\n')
}

describe('web e2e: the conversation column scrolls on one axis', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch()
    page = await newEnglishPage(browser, 900)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[data-conversation-scroll] [class*="heroGlow"]', { timeout: 30_000 })
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  /**
   * Resize to a viewport and read the column once its width stops moving.
   *
   * The glow rides the hero box, which rides the column, and the frame eases
   * its column tracks over `--ds-transition-duration-slow`: reading straight
   * after a resize can report the previous viewport's relation, or a width
   * caught mid-transition.
   * @param width - viewport width to settle at.
   * @returns the column's readings at that width.
   */
  const settleAt = async (width: number): Promise<ColumnMetrics> => {
    await page.setViewportSize({ width, height: 900 })
    let previous = -1
    await expect.poll(async () => {
      const current = (await measureColumn(page, width)).columnWidth
      const settled = current === previous
      previous = current
      return settled
    }, { timeout: 10_000 }).toBe(true)
    return measureColumn(page, width)
  }

  /**
   * Sweep the stops once per run and hand the SAME readings to every assertion
   * below, so the golden and the assertions describe one measurement instead of
   * two runs that could disagree. Memoized rather than re-run per test: the
   * gestures below move the viewport, and a second sweep would be a second
   * chance for a resize to settle differently.
   * @returns the stops in {@link WIDTHS} order.
   */
  let swept: Promise<ColumnStop[]> | undefined
  const sweep = (): Promise<ColumnStop[]> => {
    swept ??= (async () => {
      const stops: ColumnStop[] = []
      for (const width of WIDTHS) {
        stops.push({ ...await settleAt(width), scrollLeftAfterWheel: await wheelHorizontally(page) })
      }
      return stops
    })()
    return swept
  }

  it('never scrolls horizontally, at any width the glow bleeds past', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-conversation-column-overflow'))
    const stops = await sweep()
    // The vacuity guard, in two halves: the glow has to reach past the column
    // at the narrow stops, and that reach has to still register as scrollable
    // overflow. Without both, the claim below holds for free.
    expect(stops.filter(stop => stop.glowBleeds).map(stop => stop.width)).toEqual([
      1200, 1000, 800, CONTROL_VIEWPORT,
    ])
    for (const stop of stops.filter(stop => stop.glowBleeds)) {
      expect(stop.bleedRange, `viewport ${String(stop.width)}`).toBeGreaterThan(0)
    }
    for (const stop of stops) {
      expect(stop.overflowX, `viewport ${String(stop.width)}`).toBe('hidden')
      // The reported symptom, stated directly: a horizontal wheel over the
      // column moves nothing, at every stop.
      expect(stop.scrollLeftAfterWheel, `viewport ${String(stop.width)}`).toBe(0)
      // The axis the column is a scroller for must survive `overflow-x: hidden`.
      expect(stop.scrollsVertically, `viewport ${String(stop.width)}`).toBe(true)
    }
    expect(tripwire.pageErrors).toEqual([])
  }, 120_000)

  it('scrolls horizontally again once the axis is opened back up (control)', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-conversation-column-overflow-control'))
    // The mutation control, run in the page rather than against a second
    // build: it lifts exactly the `overflow-x: hidden` declaration, so the
    // initial `visible` that a one-axis scroller computes to `auto` takes
    // over, and shows the same gesture, at the same timing, carrying the
    // column to its positive scroll boundary.
    // Without it a `scrollLeft` of 0 could equally mean the wheel never arrived.
    // Injected with an id rather than through `addStyleTag`, so the teardown
    // below can take the sheet out again by selector: it must not outlive this
    // test, or the golden ends up reading the control.
    await page.evaluate((id: string) => {
      const sheet = document.createElement('style')
      sheet.id = id
      sheet.textContent = '[data-conversation-scroll] { overflow-x: auto !important; }'
      document.head.append(sheet)
    }, CONTROL_STYLE_ID)
    try {
      // Resolve the mutated layout at the narrowest sweep stop. At wider stops,
      // a classic scrollbar can change the available box enough to remove the
      // overflow that the control is meant to expose.
      const before = await settleAt(CONTROL_VIEWPORT)
      expect(before.overflowX).toBe('auto')
      expect(before.bleedRange).toBeGreaterThan(0)
      const scrollLimit = await horizontalScrollLimit(page)
      // The control has a reachable horizontal range, and the gesture exceeds
      // it so the equality below proves that the wheel reached the far edge.
      expect(scrollLimit).toBeGreaterThan(0)
      expect(scrollLimit).toBeLessThan(WHEEL_DELTA)
      // Rounded: `scrollLeft` is fractional under a fractional layout while
      // the claim is that the column reached the positive boundary, not that
      // two engines agree on a sub-pixel.
      expect(Math.round(await wheelHorizontally(page))).toBe(Math.round(scrollLimit))
    } finally {
      await page.evaluate((id: string) => {
        document.getElementById(id)?.remove()
      }, CONTROL_STYLE_ID)
    }
    // The override is gone and the shipped state is back: the later goldens
    // read the product, not the control.
    expect((await settleAt(CONTROL_VIEWPORT)).overflowX).toBe('hidden')
    expect(tripwire.pageErrors).toEqual([])
  }, 120_000)

  it('matches the committed column-overflow golden', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-conversation-column-overflow-golden'))
    await compareOrRefreshGolden(GEOMETRY_EXPECTED, renderGeometry(await sweep()), MODE)
    expect(tripwire.pageErrors).toEqual([])
  }, 120_000)

  it('commits exactly the fixtures it reads', async () => {
    // No model calls, so no replay log: the golden is the whole inventory.
    await assertFixtureInventory(SNAPSHOT_DIR, ['geometry.expected.md'])
  })

  it.skipIf(MODE === 'record')('issued zero model calls and stayed clean', () => {
    expect(tripwire.warnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  })
})
