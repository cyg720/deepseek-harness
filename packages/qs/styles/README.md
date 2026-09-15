---
description: "Qishu UI reference for implementing the workbench: themes, layout, typography, component states, motion, and acceptance criteria."
kind: "package-reference"
---

# Qishu UI design specification

English | [中文](README.zh.md)

<a id="summary"></a>

## Summary

Use this reference to implement a consistent Qishu workbench, login page, and supporting dialogs. It extracts the current prototype and separates observed values from implementation requirements. This directory contains documentation; it does not provide an installable style package, component API, or import entry point.

Visual baseline: calm green tones, restrained contrast, thin borders, small rounded corners, and generous space around the conversation. The conversation is the primary task entry; navigation and contextual tools support it.

<a id="contents"></a>

## Table of Contents

- [Sources and scope](#sources)
- [Product identity](#identity)
- [Theme colors](#themes)
- [Page layout](#layout)
- [Typography and icons](#type)
- [Spacing, corners, and elevation](#geometry)
- [Component rules](#components)
- [Interaction states](#states)
- [Responsive behavior](#responsive)
- [Motion](#motion)
- [Implementation guidance](#implementation)
- [Acceptance checklist](#acceptance)
- [Dev Note](#dev-note)

<a id="sources"></a>

## Sources and scope

The following files own the prototype evidence. Read final CSS cascade values, including overrides after media queries; an earlier declaration alone is not the rendered specification.

| Source | Purpose |
| --- | --- |
| [styles.css](../../../applications/PRD/1-AI工作台/prototype/styles.css) | Colors, dimensions, component states, breakpoints, and motion. |
| [app.js](../../../applications/PRD/1-AI工作台/prototype/app.js) | Page composition, theme placement, panel defaults, and interaction semantics. |
| [factory.svg](../../../applications/PRD/1-AI工作台/prototype/factory.svg) | Login illustration and its independent animation rules. |
| [Prototype](../../../applications/PRD/1-AI工作台/prototype/index.html) / [usage notes](../../../applications/PRD/1-AI工作台/prototype/使用说明.html) | Interactive visual reference and simulation limits. |

The scope is the login page, conversation workbench, sidebar entries, context panel, and their dialogs. Mock accounts, model labels, sample business data, and simulated connections are not production interface requirements.

<a id="identity"></a>

## Product identity

The product name is **奇术**; the Latin wordmark is **QISHU**. Use the same name in page titles, login text, assistant attribution, help, and exported document headings. The logo is the existing four-point outlined star in a rounded square; reuse its path from `brand()` and `paths.spark` rather than drawing a second mark.

The desktop header uses a 32 × 32 px logo container, 9 px corner radius, and an 18 px product name. The login story uses the lime logo on a dark green background and a 21 px product name. Preserve the distinction between the fixed login composition and the switchable workbench theme.

<a id="themes"></a>

## Theme colors

These are the existing semantic CSS variables. Values use hexadecimal notation; eight-digit values include alpha. A component must select a color by purpose, not by whether a literal happens to look correct in one theme.

| Variable | Light | Dark | Use |
| --- | --- | --- | --- |
| `--bg` | `#f9faf8` | `#1e2923` | Workbench background |
| `--surface` | `#ffffff` | `#26322a` | Header, panels, dialogs, inputs |
| `--subtle` | `#f3f5f1` | `#2c3a2f` | Secondary surfaces |
| `--sidebar` | `#f0f3ed` | `#233026` | Left navigation background |
| `--text` | `#263931` | `#e0e8d7` | Primary text |
| `--muted` | `#839086` | `#a0ad93` | Secondary text base |
| `--line` | `#e5eae1` | `#3b4838` | Dividers and borders |
| `--accent` | `#355c47` | `#617f4b` | Primary control color |
| `--accent-soft` | `#e8eee3` | `#354b32` | Soft emphasis and dark navigation hover |
| `--lime` | `#d8f38b` | `#d8f38b` | Brand highlight |
| `--danger` | `#b44838` | `#b44838` | Destructive action text; inherited in dark mode |
| `--shadow` | `0 12px 40px #233b2410` | `0 12px 40px #233b2410` | Declared shadow value; components also define local shadows |

The prototype applies `.dark` to `body` and sets `color`, `background`, and `color-scheme: dark` there. Dialogs and toast containers are outside `#root`, so theme ownership must include them. Updating variable values on the workbench alone is insufficient.

Fixed login colors: story background `#152d25`, form background `#fcfdf9`, story heading `#eef4e9`, highlight `#d8f38b`, and submit button `#355a41`. Workbench overrides include dark supporting text `#abbc99`, dark suggestion text `#b0c299`, and dark upload borders `#536648`. These are observed local values, not additional exported tokens.

For production implementation, give error, warning, success, and disabled states explicit text/background pairs in both themes. The prototype does not define a complete semantic status palette, and its inherited danger color is not evidence that every dark error state is readable.

<a id="layout"></a>

## Page layout

Keep one dominant work surface. The header owns global identity and panel toggles; the sidebar owns navigation; the center owns the current conversation; the right panel owns supporting context.

| Region | Desktop baseline | Composition |
| --- | --- | --- |
| Login | Columns `minmax(520px, 1.4fr) minmax(430px, 1fr)`; form max-width 370 px. | Dark factory illustration on the left; independent light login form on the right. |
| Header | 68 px height; 24 px horizontal padding. | Logo, product name, left-panel toggle; mode switch and right-panel toggle. |
| Left sidebar | 238 px wide; padding `21px 15px 12px`. | Workspace, new conversation, pinned/recent sessions; recent apps, six capability entries, profile and settings at the bottom. |
| Conversation | Flexible width; content max-width 690 px; 30 px horizontal scroll-area padding. | New-session welcome and composer; existing-session messages with the composer below the scrolling area. |
| Right panel | 306 px wide; 58 px tab bar; content padding `23px 20px`. | Workspace, todos, and calendar tabs; files and current project belong to the workspace tab. |

The workbench occupies `100dvh` and uses independently scrollable conversation, session-list, and right-panel content. Keep `min-width: 0` and `min-height: 0` on flexible children so long text and scroll content do not push panels outside the viewport. Collapse removes the panel width and makes its controls inert.

<a id="type"></a>

## Typography and icons

Font stack: `Inter, "Microsoft YaHei", "PingFang SC", sans-serif`; controls inherit it. The prototype does not load a webfont, so Inter is used only when available locally. Preserve Chinese fallback fonts and `font-synthesis: none`.

| Role | Observed size / weight | Use |
| --- | --- | --- |
| Welcome heading | `clamp(26px, 2.6vw, 37px)` / 450; line-height 1.45. | Short greeting and task invitation. |
| Login heading | 31 px / 550; story heading `clamp(35px, 3.3vw, 52px)` / 500. | Form and story have separate scales. |
| Composer and messages | Composer 14 px; message text 13 px; AI line-height 1.95. | Readable task input and longer answers. |
| Navigation and panels | Session links, right tabs, todo/event titles 12 px; tool links and file names 11 px. | Compact navigation and supporting content. |
| Secondary labels | Mostly 10–11 px; decorative wordmarks include 8–9 px. | Prototype observations; do not put essential instructions at decorative sizes. |

Icons use a 24 × 24 viewBox, no fill, a 1.7 px stroke, rounded caps/joins, and `currentColor`. Standard icons are 19 px; navigation/file icons are 14–16 px. An icon-only button needs an accessible name; a tooltip alone is not its label.

<a id="geometry"></a>

## Spacing, corners, and elevation

Reuse component dimensions rather than rounding every value to an invented spacing grid. The prototype uses 7–10 px internal gaps, 12–18 px card spacing, and 20–30 px page or panel padding.

| Element | Value |
| --- | --- |
| Borders | Usually 1 px solid; upload areas use 1 px dashed borders. |
| Corners | Tags 5 px; session rows 7 px; icon buttons 8 px; inputs/buttons 9 px; result cards 11 px; composer 15 px; dialogs 17 px. |
| Composer shadow | `0 8px 24px #41502d05`; focused `0 6px 24px #496b2610`. |
| Dialog overlay | Shadow `0 25px 120px #23342433`; backdrop `#1a2b224d` with 4 px blur. |
| Stacking | Mobile backdrop z-index 19; right panel 20; left panel 25; toast 100; native dialog in the top layer. |

<a id="components"></a>

## Component rules

Keep controls purpose-specific and reuse the same appearance for the same action across pages. The selector names below identify prototype examples, not a public component API.

| Component | Reference | Behavior and appearance |
| --- | --- | --- |
| Buttons | `.btn`, `.icon-button` | Primary: solid accent with white text; secondary: surface with border; destructive: labeled danger action. Default icon hit box 34 × 34 px. |
| Login fields | `.field`, `.input-wrap` | Persistent label, leading icon, optional password visibility control; minimum field height 44 px; submit height 48 px. Keep validation beside the form. |
| Conversation input | `.composer` | Padding `17px 16px 12px`; new-session textarea min-height 69 px, conversation min-height 53 px, max-height 150 px. Attachments above; tools/model below; send at bottom right. |
| Session navigation | `.session-row` | Single-line ellipsis; hover/focus exposes management actions; the active session remains identifiable. Pinning is separate from selection. |
| Assistant result | `.message`, `.result-card` | User bubble on the right, AI answer on the left. Results carry sources, timestamps, and state; related actions remain next to the result. |
| Application entries | `.recent-app`, `.catalog-card` | Recent icons provide names; catalogs use icon, title, short description, and one principal entry action. Desktop catalog has two columns. |
| Context controls | `.right-tab`, `.todo-item`, `.calendar-day` | Tabs switch one panel; todos pair checkbox and text; calendar selection, event markers, and current day use distinct cues. |
| Dialog and toast | `dialog`, `.toast` | Dialog width `min(590px, 100vw - 30px)` or 830 px for wide content; max-height 88dvh. Close control at top right; cancel/confirm below. Toast is non-blocking at the bottom center. |

<a id="states"></a>

## Interaction states

Define resting, hover, selected, focus, disabled, loading, empty, and error states together. Theme switching must cover all of them, including controls rendered in dialogs.

| State | Observed rule | Implementation requirement |
| --- | --- | --- |
| Dark navigation hover/focus | `.session-row`, `.tool-link`, `.recent-app`, `.new-chat`: background `--accent-soft`, text `--text`. | Cover `:hover`, `:focus-visible`, and `:focus-within`; selected-session hover must stay dark. |
| Light navigation hover | Session background `#e4eadf`; tool background `#e2e9db`; recent app background `#e0eacb`. | Do not reuse these light fills for dark components. |
| Selection | Light session `#e0e9d7`; dark session `--subtle`; active tabs have a 2 px bottom border. | Persistent selection must not depend on the pointer remaining over a control. |
| Focus | Buttons/links: 3 px `#80a65c`, offset 3 px; inputs: 2 px `#8ead80`, offset 1 px. | Retain visible focus; the composer uses its focused outer border rather than a textarea outline. |
| Disabled/loading | Disabled buttons use opacity .4 and a not-allowed cursor; generation exposes stop. | Use real disabled semantics and keep an explicit loading label; do not communicate state by color alone. |
| Empty/error | Empty panels explain what is missing; login errors use an alert region. | Provide a next action or correction and keep entered content when an operation fails. |

Reference dark navigation colors are `#354b32` and `#e0e8d7`; the [recorded hover check](../../../applications/PRD/1-AI工作台/prototype/validation/theme-brand-report.json) reports a text contrast ratio of approximately 7.57:1 for these controls. This is evidence for those controls only, not a full accessibility audit.

<a id="responsive"></a>

## Responsive behavior

Apply these breakpoint rules cumulatively. Initial panel visibility comes from the JavaScript viewport check: left open above 700 px, right open above 960 px.

| Viewport | Final layout changes |
| --- | --- |
| ≥ 1600 px | Header 73 px; left 257 px; right 335 px; conversation max-width 750 px. |
| 1151–1599 px | Use the desktop baseline in the layout section. |
| 961–1150 px | Left 213 px; right 274 px; conversation padding 22 px; hide the platform subtitle and deep-thinking chip. |
| 701–960 px | Right panel overlays the workspace at 306 px, below the 68 px header; login uses equal columns. |
| ≤ 700 px | Header 61 px; left overlay 238 px; right overlay `min(306px, 90vw)`; show one side panel at a time with a dismissible backdrop. |
| ≤ 700 px content | Hide the login illustration; show the form brand; one-column catalogs; form/composer text 16 px; welcome heading 28 px. |

Implementation must keep long names, attachment names, dialog actions, and the composer within the viewport. Make destructive and management actions available without hover on touch screens. The prototype has viewport-dependent initial state but no general resize listener; live-resize behavior needs explicit verification in the implementation.

<a id="motion"></a>

## Motion

Motion indicates state or connection; it must not delay reading or input. Panel width transitions last .2 s; message arrival lasts .25 s with a 5 px rise; generation dots cycle every 1 s with .2 s staggering.

The factory SVG uses an isometric schematic, translucent AI console, and an operator connected to the site. Light pulsing and dashed connection flow last 3 s; vertical floating lasts 6 s with 5 px displacement. Both CSS documents disable animation under `prefers-reduced-motion: reduce`; the workbench also disables transitions and smooth scrolling.

<a id="implementation"></a>

## Implementation guidance

Use the following requirements when moving the design into application code. They describe how to implement this reference, not APIs already provided by this directory.

- Centralize theme values and shared component states. Reuse the semantic roles above; avoid copying the prototype’s repeated overrides or inline state colors into each application.
- Apply the theme to the common ancestor of app content and overlays. Preserve session data when switching themes or changing the visible product name.
- Separate layout, shared controls, and business rendering. Reuse button, field, dialog, tab, file, and message presentation rules rather than maintaining per-page variants without a specific need.
- Use semantic buttons, inputs, labels, tabs, dialogs, alert/status regions, and state attributes. Restore focus after closing overlays; hidden panels must not receive focus.
- Route product copy through the application’s typed locale dictionaries. Keep file names and user messages as user content, separate from UI translations.
- Treat real loading, authorization failures, unavailable data, empty results, and execution errors as separate visible states. Mock success messages are not implementations of these states.

The example below reuses the existing dark-navigation rule; it requires the theme variables and shared control styles above. It is a styling reference, not a package import example.

```css
.dark :is(.session-row, .tool-link, .recent-app, .new-chat):is(:hover, :focus-visible, :focus-within) {
  background: var(--accent-soft);
  color: var(--text);
}
```

Keep state pseudo-classes on the target selector itself; do not introduce a descendant combinator when formatting or translating selector rules.

<a id="acceptance"></a>

## Acceptance checklist

Review the implementation against the following list. The [prototype browser report](../../../applications/PRD/1-AI工作台/prototype/validation/report.json) records historical interaction checks; it does not certify new application code.

- Check login, new conversation, existing conversation, catalogs, dialogs, files, todos, and calendar in both themes where theme switching applies.
- Exercise hover, selected hover, keyboard focus, disabled, loading, empty, and error states. Dark sessions and app entries must not become light-filled on hover.
- Test representative widths of 390, 700, 960, 1150, 1440, and 1600 px and both sides of each breakpoint. No horizontal page overflow or unreachable controls is acceptable.
- Verify keyboard navigation, visible focus, dialog dismissal, touch access to management actions, and reduced-motion behavior.
- Use at least 4.5:1 contrast for normal text as an implementation acceptance target. Review small prototype labels and dark status colors individually; do not assume the whole palette meets this target.
- Save light, dark, hover, and mobile screenshots together with the executed checks; keep theme changes independent of business-data changes.

<a id="dev-note"></a>

## Dev Note

No additional design proposals. Runtime CSS exports, component implementation, and application API integration are outside this documentation extraction.
