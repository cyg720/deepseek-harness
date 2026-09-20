# Agent Note: Qishu workbench client plugin family

Status: implemented

English | [中文](2026-09-17-qishu-workbench-client-plugins.zh.md)

## Problem

The Qishu workbench has to replace the official Web interface for one deployment without forking any official UI package, and without letting the two interfaces fight over the same slots. The seven workspace packages already exist as empty scaffolds ([Qishu workspace scaffolds](2026-09-17-qs-workspace-scaffolds.md)); what remained undecided is how a family of first-party client plugins claims the whole frame, how they share appearance and behaviour when the bundle-purity gate forbids value imports between them, and how a deployment gets the official interface back.

## Decision

The workbench is one root occupant plus six contributing packages. `qs-shell` registers into `root` at priority `-1000`. A `single` slot rejects two entries at the same priority and renders only the lowest among different priorities, so a **negative** priority is what makes the workbench the winner; the official `AppFrame` stays registered and stays loaded underneath.

`qs-shell` declares every top-level `qs.*` slot in one registration and the three stage holes in a second registration for `qs.stage`. The second registration is what makes the `Stage` component the rendering host for `qs.stage.body`, `qs.stage.transcript`, and `qs.composer`. The other six packages contribute through `ctx.slots.inject`, so load order carries no requirement and a missing package degrades to "that hole renders nothing" rather than a failed boot.

Two channels carry everything across package boundaries, and no third exists. Appearance travels through the global sheets `packages/qs/qs-shell/src/client/styles/tokens.css` and `.../contract.css`: the shell injects them, scopes them to `.qs-root`, and every other package uses the `--qs-*` tokens and `.qs-*` class names without importing anything. Behaviour travels through slots or Cordis services. The bundle-purity gate refuses runtime value imports between `@deepseek-ai/dsh-qs-*` packages, so `qs-transcript` cannot import `qs-shell`'s components even though they are one product; type-only imports are erased and remain the one cross-package type channel.

A slot's inject face belongs to the **declaring** entry, not to the contributing one. `SlotSpec` in `packages/client/ui-slots/src/index.ts` requires the `children` declaration to carry the inject object, and the registrant's own `inject` factory is a separate business face. This is why `qs.stage.transcript.row` and `qs.stage.interaction` are declared by `qs-transcript` in its own contract rather than by the shell: the shell declares the transcript hole, but only qs-transcript can supply the chat-node keyed hooks that populate it.

`qs.stage.transcript` is the one strict-`session` hole in the workbench, and `Stage` therefore reads the current session id before rendering it — a strict session slot throws `SlotAssemblyError` when no binding exists. `qs.stage.body` and `qs.composer` are `session-maybe` so the welcome pane and the input box survive with no session selected; the composer's `inputActions` is `undefined` there, which is why the no-session send path creates a session first.

The developer switch is a controller owned by the shell whose lifetime is independent of the workbench root registration. `defaultUi: official` keeps every row loaded but registers no workbench root, so the official frame wins without a restart; disabling all seven rows is the separate path that releases every workbench registration. The two are not interchangeable: a priority change hands rendering back without cleaning anything up. The deployment-level `showOfficialUiEntry` gate refuses the switch action itself, not merely the button. Row config reaches the browser through the `webserver/index-inject` global `__QS_UI_CONFIG__`, because a `dsh.client` row's browser half is loaded by the client module system and never sees Loader row config.

The login gate is an interface selector, not a security boundary: `/api` has no per-user authorization, and the Agent Note says so where the service is declared. `qs-shell` reads `useQsAuth` as an optional seat rather than through `inject`, because a missing required service leaves the fiber pending forever and a permanently pending shell could never render the "sign-in plugin is not loaded" fault page. For the same reason the shell renders a fault page instead of falling through to the official interface when a workbench component throws.

First-send creation uses a preallocated identity and a component-owned cancellation signal. Failed creation does not authorize navigation, even when its error carries that identity. Cancellation, intervening navigation, and plugin disposal suppress late opening; the component releases the shell freeze on unmount. Retry reuses the reserved identity, while successful handoff clears it. Queue operations retain their addressed Session and inspect RemoteResult before announcing failure. The composer reads the official input facade notices and block registry instead of maintaining parallel error or admission state.

Session-list creation uses the same cancellation ownership; a failed request remains visible in the navigation instead of becoming an unhandled promise. Approval retries retain the original decision, so a failed allow can never become a reject through the retry control.

The transcript treats system prompts, process controls, and Turn tails as official Chat node kinds. Instruction context and reasoning remain available through collapsed disclosures; process summaries and exact token totals use typed projection fields. Unknown extension payloads use bounded disclosures. This preserves model-visible records without making internal metadata or duplicate closing messages part of the default conversation body.

Single-choice answers discard superseded custom text. Menu lifetimes suppress late UI callbacks without cancelling accepted server operations. Transcript following distinguishes active submissions from passive updates and historical prepends. Collapsed unknown payloads defer serialization; non-text history has a visible limitation notice, and local Markdown media retains the official file API policy.

## Alternatives considered

- **Registering the workbench at priority 0 (or replacing the official row)** throws on the second same-priority entry into a `single` slot, and deleting the official `ui-layout` row removes the official interface the developer switch exists to reach. A negative priority keeps both and lets configuration decide.
- **One package for the whole workbench** would need no cross-package channel at all, but it contradicts the user-selected seven-package split and would make every later change touch one large package. The [scaffold note](2026-09-17-qs-workspace-scaffolds.md) records that split.
- **A shared `qs-ui` package holding the tokens and shared controls** is the obvious way to avoid duplicating markup, and it is what the bundle-purity gate forbids: `@deepseek-ai/dsh-qs-*` is not in the default client externals, and `dsh.client.external` is not a feature-plugin dependency mechanism. Global class names and tokens carry appearance instead, and behaviour crosses through slots.
- **Declaring all eleven `qs.*` slots from the shell, including the two the transcript owns**, type-checks but cannot work: the inject face a slot declares must be supplied by whoever declares it, and the shell has no chat-node reader to supply.
- **Making the workbench the only registered frame and disabling the official rows** was rejected because the developer switch has to reach the installed official interface, including features the workbench does not implement.

## Consequences

Layout preferences and the opt-in demo marker use local browser storage; transcript reading positions belong to the Session binding in memory. Question drafts follow the official request result rather than its current visibility, because a pending request can be hidden by a higher-priority interaction. Interface switching must neither answer a request nor discard its live draft.

Appearance is duplicated in class names rather than in code: a change to `.qs-btn` reaches every package, but each package still writes its own markup, keyboard handling, focus restoration, and accessible names. That duplication is the price of the purity gate and is deliberate.

The family is order-independent and partially degradable. Any subset of the six contributing packages can be absent without a boot failure; the workbench then renders that hole empty, and a missing `qs-login` produces an explicit fault page rather than a silent pass-through. The composition test in `packages/qs/qs-shell/tests/composition.client.spec.tsx` mounts all seven against the real `SlotRegistry` and asserts one occupant per `single` slot, because "each package compiles alone" is not evidence that the slot tree holds.

The workbench holds the whole frame, so any component it renders must survive an environment without the full browser API set. A `matchMedia` call without a capability check crashed the root occupant under jsdom, and the renderer's per-entry boundary then **abdicated the root entry** — the official `AppFrame` came back silently and every official browser scenario still passed. A crash in a root occupant is not a visible failure; it is a silent product swap, so the workbench's own capability assumptions are part of its contract.

The same lane caught a boot-breaking one: `qs-composer` registered into `qs.composer` directly instead of through `ctx.slots.inject`. Under `defaultUi: official` nothing declares that slot, so the registration threw and the whole loader entry failed — breaking the exact mode the developer switch exists to provide. Every one of the six contributing packages now waits for its declaration, which is what makes a composition without the workbench root a supported mode rather than a crash.

The official browser lane pins `defaultUi: official` for the same reason the shipped roster pins `workbench`: those scenarios verify the official Web product, and a scenario that means to test the workbench must ask for it.

`qs.status` and `qs.overlay` carry occupants now: a connection strip with a manual reconnect and a toast host behind the `qsToast` service. Dialogs deliberately bypass that host, because a native `<dialog>.showModal()` reaches the top layer on its own. The developer switch has both entries: the top bar hides its button entirely when the deployment does not enable it, and the official sidebar's footer slot carries the return entry.

The [official source change list](../../../../../qishu/官方源码改动记录清单/00-登记规则与索引.md) is the authority for which official files this family touches and which verifications have actually run.
