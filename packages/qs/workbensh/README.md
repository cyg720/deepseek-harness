---
description: "Self-authored workbench shell for the DSH Web client: it takes the built-in root slot so no shipped UI plugin renders, while consuming the shipped conversation data plane so agent interaction keeps working."
kind: "package-reference"
---

# @deepseek-ai/dsh-workbensh

English | [中文](README.zh.md)

## Summary

`dsh-workbensh` gives you the whole Web surface: your own shell, navigation, and panels render the first screen, and every shipped UI plugin stays silent because nothing renders its slots. Agent interaction still works, because the shipped conversation, chat, session, and approval data planes keep running and hand you folded snapshots through standard framework hooks. Choose it when you want your own outer frame with no shipped component reuse; the cost is that every view, including approvals and user questions, is yours to write.

## Table of Contents

- [Use this package](#use-this-package)
- [Rendering ownership](#rendering-ownership)
- [Conversation data plane](#conversation-data-plane)
- [Loading policy](#loading-policy)
- [Layout plan](#layout-plan)
- [Rollout plan](#rollout-plan)
- [Risks and mitigations](#risks-and-mitigations)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this package as an ordinary browser plugin row and it takes the first screen; nothing else is required to make the shipped UI disappear.

### When to choose it

Choose it when the product is a workbench of your own: your navigation, your panels, your visual language, and no reuse of shipped components at all. Avoid it when you only want to replace the central panel while keeping the shipped sidebar, settings, and conversation chrome — that path keeps the shipped frame as the root occupant and registers a `main` panel key instead, which is far less work. There is no middle ground inside this package: slot rendering authorization means a root occupant can never render the shipped frame's child slots, so "own the shell and embed shipped pieces" is not expressible.

### Minimal configuration

The package declares no configuration schema. Its smallest working mount is one browser plugin row in a Web composition:

```yaml
- insert:
    - id: workbensh
      name: '@deepseek-ai/dsh-workbensh'
```

It also needs the three composition surfaces every browser plugin needs: a TypeScript project reference in `tsconfig.client.json`, the row above in the Web bundle's patch, and a dependency edge from that bundle so the profile can resolve the package name. Without the row the bundle is never scanned and the package has no effect.

<a id="rendering-ownership"></a>
## Rendering ownership

`ui-renderer` calls `ctx.slots.renderSlot('root', {})` and that is the page's only mount point. `root` is a `single` slot, and `ui-layout` occupies it with the shipped `AppFrame`, declaring `sidebar`, `main`, `rightbar`, and `shell.overlay` as its children.

Three rules decide how this package takes over.

1. **Priority decides the occupier.** Two registrations into one `single` cell at the same priority throw, and the lowest priority renders. Registering `root` at a negative priority shadows the shipped frame; registering at the default priority fails the boot loudly. The shadow is the switch: remove the priority and the shipped UI returns.
2. **Declaration is render authorization.** A registration may render exactly the child keys it declared, and declaring a key someone else declared fails at load. A root occupant therefore cannot render `sidebar` or `main`, and cannot redeclare them either. Own the shell means own every pixel.
3. **A session seat is explicit.** The framework installs the SessionProvider seat only for entries whose children include a `scope: 'session'` slot. Declaring one is what makes session data and the session hooks reachable at all; without it the shell can only read the global session list.

A render failure in the root occupant retires that registration and the next candidate renders, so a crashing shell falls back to the shipped UI instead of a blank page. That is a safety net, not a design: it presents as the shipped frame reappearing.

<a id="conversation-data-plane"></a>
## Conversation data plane

The shipped data plane stays loaded, so this package consumes folded data instead of reimplementing event folding or streaming. Every member below is a framework standard seat available inside a session-scoped subtree; none of them requires importing a shipped component, and their types arrive through type-only imports.

| Seat | Content |
|---|---|
| `useChat` | Folded chat snapshot: assistant streaming, messages, tool calls, turn process, turn tail, turn errors, retries, compaction, commands, inbox rows, and the unknown fallback. |
| `useConversation`, `useInput`, `inputActions` | Conversation snapshot, input-machine state, and the input action face for sending, steering, queueing, and cancelling. |
| `useSession`, `sessionId`, `projection` | Session lifecycle snapshot, identity, and keyed projections. |
| `useSessionPendingInteraction` | The session's pending interaction, if any. |
| `loadOlder` | Pulling the next older history page. |

Two consequences decide the work estimate.

- **View activation is automatic.** Each session binding restores the persisted view and activates the chat target, so a subscriber sees data whether or not the shipped shell renders. This package therefore never needs the shipped conversation root to run.
- **Pending interactions block the agent.** Approval and question requests arrive as answerable values; the shipped presenters render them into a composer slot this package does not render. Reading the pending interaction and answering it is mandatory, not cosmetic: an unanswered request leaves the agent waiting. This is the phase that decides whether the workbench is usable.

<a id="loading-policy"></a>
## Loading policy

This package **shadows** the shipped UI; it never disables it.

Disabling shipped rows is supported by the patch format and is the wrong move here. Slot declarations die with their declaring entry, so disabling a declarer while its registrants still load turns every one of those registrations into a load-time failure. The dependency is concrete: `ui-layout` declares `main`, and `ui-conversation` registers into `main` and declares `main.conversation`. Disabling the first while keeping the second does not degrade the UI, it breaks the boot. Worse, the data plane this package depends on is exactly those packages: `ctx.uiConversation`, the chat target, the session hooks, and the pending-interaction plumbing all come from rows that a "disable all shipped UI" reading would remove.

Rows that must stay loaded and unrendered:

- Kernel: `ui-renderer`, `ui-slots`, `client-store`, `connection`, `api-remotes`, `api-session-controller`, `api-workspace-controller`, `locale`, `ui-theme`, `modules`.
- Data plane: `ui-session`, `ui-conversation`, `ui-chat`, `ui-approval`, `ui-user-questions`.
- Forced by declaration order: `ui-layout`.
- Optional data: `ui-trajectory`, `ui-commands`, `ui-model-selection`, `ui-agent-preset`, `ui-workflow-run`, `ui-deliverables`, `ui-goal`.

Rows that merely never render, and therefore need no action: `ui-sidebar*`, `ui-tool`, `ui-settings*`, `ui-brand-official`, `ui-directory-picker*`, `ui-input-trigger`, `ui-reference`, `ui-skill`, `ui-subagent`, `ui-plan`, `ui-attachment`, `ui-jobs`, `ui-schedule`, `ui-message-feedback`, `ui-permission-presets`, `ui-open-in-app`, `ui-cordis`. Reclassifying any row as safe to disable requires checking its source for `provide`, `events.register`, `views.register`, `registerPendingInteraction`, or `remote.$on`; a name that reads like presentation can still own a service or a data definition.

The payoff of shadowing over disabling is maintenance: shipped rows can be added, renamed, or reordered by an upgrade without this package keeping a disable list in sync.

<a id="layout-plan"></a>
## Layout plan

The shell declares its own slot family under a `qs.` prefix, so no key can collide with a shipped one and every key is unambiguously owned here.

| Key | Kind | Purpose |
|---|---|---|
| `qs.chrome` | `single` | Top bar: session identity, primary actions, global status. |
| `qs.nav` | `single` | Left navigation and workspace switching. |
| `qs.stage` | `keyed` | The main work area, dispatched by view key. |
| `qs.stage.session` | `session` | The session-bound stage body. This is the seat that unlocks every session hook. |
| `qs.inspector` | `single` | Right column: details, references, secondary tools. |
| `qs.status` | `list` | Bottom strip: transient facts contributed by feature plugins. |
| `qs.overlay` | `list` | Frame-wide floating layer for toasts, palettes, and modals. |

Feature plugins added later contribute into these keys instead of declaring their own, which keeps one composition route for the whole workbench. Layout state — collapsed columns, widths, the active view key — belongs in a store declared at registration, not in component state, so it survives remounts within a reload.

<a id="rollout-plan"></a>
## Rollout plan

Each phase ends with a check that must pass before the next one starts.

| Phase | Work | Acceptance |
|---|---|---|
| P0 Blank root | Package skeleton, three composition surfaces, root registration at negative priority, a placeholder full-screen container. | The shipped frame is gone from the first screen, the page is not blank, the console is clean, and a bundle rewrite hot-replaces the placeholder. |
| P1 Layout | Declare the `qs.*` family, including the session-scoped seat; add the layout store and basic collapse/resize behavior. | The shell lays out, persists its layout across a reload, and the shipped UI is still absent. |
| P2 Data | Inside the session seat: select the current session, subscribe to the chat snapshot, and render a plain text transcript list. | A sent prompt produces visible streaming deltas, and a hot reload does not lose the session. |
| P3 Transcript | Render your own components per node kind, in batches: assistant, message, tool call, then turn process, tail, error, retry, compaction, inbox, fallback. | Replayed history and live appends produce the same result, and prepending history does not flicker existing rows. |
| P4 Input | Wire `inputActions` and the input snapshot: send, steer, queue, cancel, draft; attachments and references may follow. | Send, cancel, queue, and history paging all work, including IME composition. |
| P5 Blocking surfaces | Render and answer pending approvals and user questions in this package's own chrome. | A tool that requires approval and an `ask_user_question` call both continue after being answered in this UI. |
| P6 Shell completion | Multi-panel behavior, shortcuts, command palette, settings surface, locale dictionary, accessibility, error boundaries. | A second plugin of your own contributes into a `qs.*` key without touching this package. |
| P7 Third-party access | Host-half same-origin routes for third-party services, or typed remote methods where a strict unary contract is required. | The UI reaches an external service without CORS exposure and without a credential in the browser bundle. |

P5 is not optional and should not be deferred past a usable demo: until it lands, any tool call that needs a decision stalls the session.

<a id="risks-and-mitigations"></a>
## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Pending interaction never rendered | The agent waits indefinitely; the symptom looks like a hung session | Treat P5 as a gate, and verify with a real approval and a real question |
| Root registered at the default priority | Boot fails loudly with a duplicate-occupier error | Fix the priority in one place and document the shadow switch |
| Session seat forgotten | No session data or hooks anywhere in the shell | Declare the session-scoped seat in P1, before any data work |
| Root occupant throws | The registration retires and the shipped frame reappears | Keep an error boundary at the shell root and log the failure |
| Attempting partial reuse of shipped UI | Load-time authorization errors | Decide once: no shipped component is rendered |
| Shipped snapshot shapes change on upgrade | Transcript renderers need edits | Keep every data consumption point in one adapter layer |
| Disabling shipped rows to save startup cost | Load-time failures from orphaned registrations | Shadow instead of disabling; reclassify a row only after checking its source |
| Multi-session side-by-side layouts | The shipped model resolves one current session per seat | Keep the first version single-session |

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package is a single browser-half plugin: one registration takes the root slot, and the component behind it owns the entire tree. It has no host half of its own and registers no session event, tool, prompt section, or provider request; the shipped data plane does all folding, and this package only reads.

The design rests on three framework facts rather than on shipped code: the root slot is the page's only mount point, slot registrations compete by priority within a cell, and declaration equals render authorization. Together they mean "own the first screen" is one registration, and "reuse the shipped pipeline without the shipped UI" is one declared session seat.

Dataflow: the shipped session controller owns the event window, the shipped conversation assembler folds it into the chat target snapshot, and this package subscribes to that snapshot inside a session-scoped subtree. Input flows back through the shipped input machine's action face. Pending approvals and questions arrive as answerable values on the session pending-interaction hook, and this package answers them from its own chrome.

| File | Responsibility |
|---|---|
| `src/index.ts` | Host half: empty plugin body; exists so the Loader row has a module to mount. |
| `src/client/index.ts` | Root registration, the `qs.*` child declarations, the layout store seat, and the shell's plugin body. |
| `src/client/shell/` | Shell frame: chrome, navigation, stage, inspector, status, overlay. |
| `src/client/transcript/` | Per-node-kind views over the chat snapshot, plus the single adapter that reads snapshot shapes. |
| `src/client/interactions/` | Approval and user-question surfaces over the session pending-interaction hook. |
| `src/client/locales.ts` | Typed copy dictionaries; every product-visible string lives here. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these before changing the shell's ownership model or its data consumption.

- [Slots subsystem](../../../docs/subsystems/slots.md) — declaration, priority shadowing, render authorization, and the current slot tree.
- [Client modules subsystem](../../../docs/subsystems/client-modules.md) — how a browser plugin bundle is scanned, served, and hot-replaced.
- [Conversation subsystem](../../../docs/subsystems/conversation.md) — the fold, the view targets, and the node contracts this package renders.
- [Web client architecture](../../../docs/subsystems/web-client.md) — the object layer and layering rules behind the hooks consumed here.
- [Client plugin rules](../../client/AGENTS.md) — export, dependency, and shared-module discipline for browser packages.
- [Adding a package](../../../docs/cookbook/adding-a-package.md) — the package checklist this README's pair and gates follow.

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side UI plugin layer that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These constraints are current package properties, not a backlog.

- **No shipped component is reusable** — render authorization binds a component to the child keys it declared, so owning the root slot means owning every view; there is no supported way to embed a shipped frame, conversation, or settings surface inside this shell.
- **Blocking interaction surfaces are mandatory** — approvals and user questions must be rendered and answered here; omitting them stalls the agent rather than degrading the UI.
- **The transcript renderer tracks shipped snapshot shapes** — chat node data and view snapshots are owned by shipped packages, so an upgrade that changes them requires edits in the transcript adapter.
- **Every shipped client row still loads** — shadowing removes the rendering, not the plugin bodies; their registrations, service contributions, and subscriptions still run, and their startup and memory cost is unchanged.
- **Startup cost is not recoverable by disabling rows** — the rows worth disabling are entangled with the data plane and with each other's declarations, so the accepted state is "load everything, render nothing".
- **Multi-session layouts are unverified** — the shipped session seat resolves the current session, so side-by-side session views are outside the design until proven otherwise.
- **The directory and package name spelling is pending confirmation** — `workbensh` versus `workbench` must be settled before the TypeScript alias, composition row, and bundle dependency are written, because the directory name and the package name have to agree.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Companion files required by the documentation gates before this package can land: `README.zh.md` (the Chinese pair referenced by the language switcher and checked by the translation-pairing gate), `README.i18n.yaml` (the sidecar), and a one-line audit entry for `packages/qs/workbensh` in `SENTENCE_MODEL_EXPERIENCE` inside `scripts/verify-package-readme-model-experience.ts` — the Model Experience gate rejects the short form for any package missing from that allowlist. Regenerate the directory-to-alias mapping with `pnpm run gen-tsconfig-paths` once the package manifest exists.

</details>
