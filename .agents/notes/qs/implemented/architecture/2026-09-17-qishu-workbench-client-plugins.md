# Agent Note: Qishu workbench client plugin family

Status: implemented

English | [中文](2026-09-17-qishu-workbench-client-plugins.zh.md)

## Problem

The workbench follows official UI plugin responsibilities, with an independent custom login exception. Official services retain Session and execution ownership, and the official interface remains available to developers.

## Decision

Nine official-aligned presentation plugins and one custom login package form the workbench. qs-shell registers root at -1000; the official AppFrame stays loaded and switching does not replace service instances.

qs-shell declares layout seats; qs-ui-sidebar declares qs.nav; qs-composer declares qs.stage.body, qs.stage.transcript and qs.composer; qs-transcript declares row seats; qs-composer owns the fixed pending seat and interaction chain. Each plugin waits through slots.inject and releases its own registrations on disposal.

Two channels carry everything across package boundaries, and no third exists. Appearance travels through the global sheets `packages/qs/qs-shell/src/client/styles/tokens.css` and `.../contract.css`: the shell injects them, scopes them to `.qs-root`, and every other package uses the `--qs-*` tokens and `.qs-*` class names without importing anything. Behaviour travels through slots or Cordis services. The bundle-purity gate refuses runtime value imports between `@deepseek-ai/dsh-qs-*` packages, so `qs-transcript` cannot import `qs-shell`'s components even though they are one product; type-only imports are erased and remain the one cross-package type channel.

A slot's inject face belongs to the **declaring** entry, not to the contributing one. `SlotSpec` in `packages/client/ui-slots/src/index.ts` requires the `children` declaration to carry the inject object, and the registrant's own `inject` factory is a separate business face. This is why `qs.stage.transcript.row` is declared by `qs-transcript` in its own contract rather than by the shell: the conversation plugin declares the transcript seat, but only qs-transcript can supply the chat-node keyed hooks that populate it.

`qs.stage.transcript` is the one strict-`session` hole in the workbench, and `Stage` therefore reads the current session id before rendering it — a strict session slot throws `SlotAssemblyError` when no binding exists. `qs.stage.body` and `qs.composer` are `session-maybe` so the welcome pane and the input box survive with no session selected; the composer's `inputActions` is `undefined` there, which is why the no-session send path creates a session first.

The developer switch is a controller owned by the shell whose lifetime is independent of the workbench root registration. `defaultUi: official` keeps every row loaded but registers no workbench root, so the official frame wins without a restart; disabling all QS rows is the separate path that releases every workbench registration. The two are not interchangeable: a priority change hands rendering back without cleaning anything up. The deployment-level `showOfficialUiEntry` gate refuses the switch action itself, not merely the button. Row config reaches the browser through the `webserver/index-inject` global `__QS_UI_CONFIG__`, because a `dsh.client` row's browser half is loaded by the client module system and never sees Loader row config.

The login gate is an interface selector, not a security boundary: `/api` has no per-user authorization, and the Agent Note says so where the service is declared. `qs-shell` reads `useQsAuth` as an optional seat rather than through `inject`, because a missing required service leaves the fiber pending forever and a permanently pending shell could never render the "sign-in plugin is not loaded" fault page. For the same reason the shell renders a fault page instead of falling through to the official interface when a workbench component throws.

First-send creation uses a preallocated identity and a component-owned cancellation signal. Failed creation does not authorize navigation, even when its error carries that identity. Cancellation, intervening navigation, and plugin disposal suppress late opening; the component releases the shell freeze on unmount. Retry reuses the reserved identity, while successful handoff clears it. Queue operations retain their addressed Session and inspect RemoteResult before announcing failure. A synchronous in-flight guard serializes queue writes because blur and click can arrive before React renders disabled controls; the controls unlock after settlement. The composer reads the official input facade notices and block registry instead of maintaining parallel error or admission state.

Session-list creation uses the same cancellation ownership; a failed request remains visible in the navigation instead of becoming an unhandled promise. Approval retries retain the original decision, so a failed allow can never become a reject through the retry control.

The transcript treats system prompts, process controls, and Turn tails as official Chat node kinds. Instruction context and reasoning remain available through collapsed disclosures; process summaries and exact token totals use typed projection fields. Unknown extension payloads use bounded disclosures. This preserves model-visible records without making internal metadata or duplicate closing messages part of the default conversation body.

Single-choice answers discard superseded custom text. Menu lifetimes suppress late UI callbacks without cancelling accepted server operations. Transcript following distinguishes active submissions from passive updates and historical prepends. Collapsed unknown payloads defer serialization; non-text history has a visible limitation notice, and local Markdown media retains the official file API policy.

Plugin tests mount the real SlotRegistry and invoke entry inject factories; registration counts alone cannot verify service wiring. Deferred results control creation, answers and disposal, while DOM tests verify user-visible outcomes and actual answer payloads. These tests exercise independent plugin bundles without introducing shared runtime component imports.

Approval, question and menu submissions hold synchronous instance locks because React state updates alone do not exclude repeated events before a render commits. Failed operations release the lock for retry. Transcript row dispatch uses live slot keys with an unknown-row fallback, while scroll restoration retains a pending target until browser geometry permits it.

## Alternatives considered

- **Registering the workbench at priority 0 (or replacing the official row)** throws on the second same-priority entry into a `single` slot, and deleting the official `ui-layout` row removes the official interface the developer switch exists to reach. A negative priority keeps both and lets configuration decide.
- **Combining several official plugins into a product-feature package** mixes disposal and slot declaration ownership; keep official plugin responsibilities independent, with login as a custom extension.
- **A shared `qs-ui` package holding the tokens and shared controls** is the obvious way to avoid duplicating markup, and it is what the bundle-purity gate forbids: `@deepseek-ai/dsh-qs-*` is not in the default client externals, and `dsh.client.external` is not a feature-plugin dependency mechanism. Global class names and tokens carry appearance instead, and behaviour crosses through slots.
- **Declaring all eleven `qs.*` slots from the shell, including the two the transcript owns**, type-checks but cannot work: the inject face a slot declares must be supplied by whoever declares it, and the shell has no chat-node reader to supply.
- **Making the workbench the only registered frame and disabling the official rows** was rejected because the developer switch has to reach the installed official interface, including features the workbench does not implement.

## Consequences

Layout preferences and the opt-in demo marker use local browser storage; transcript reading positions belong to the Session binding in memory. Question drafts follow the official request result rather than its current visibility, because a pending request can be hidden by a higher-priority interaction. Interface switching must neither answer a request nor discard its live draft.

Appearance is duplicated in class names rather than in code: a change to `.qs-btn` reaches every package, but each package still writes its own markup, keyboard handling, focus restoration, and accessible names. That duplication is the price of the purity gate and is deliberate.

The family is order-independent and partially degradable. Any subset of the contributing packages can be absent without a boot failure; the workbench then renders that hole empty, and a missing `qs-login` produces an explicit fault page rather than a silent pass-through. The composition test in `packages/qs/qs-shell/tests/composition.client.spec.tsx` mounts all ten against the real `SlotRegistry` and asserts one occupant per `single` slot, because "each package compiles alone" is not evidence that the slot tree holds.

The workbench holds the whole frame, so any component it renders must survive an environment without the full browser API set. A `matchMedia` call without a capability check crashed the root occupant under jsdom, and the renderer's per-entry boundary then **abdicated the root entry** — the official `AppFrame` came back silently and every official browser scenario still passed. A crash in a root occupant is not a visible failure; it is a silent product swap, so the workbench's own capability assumptions are part of its contract.

The same lane caught a boot-breaking one: `qs-composer` registered into `qs.composer` directly instead of through `ctx.slots.inject`. Under `defaultUi: official` nothing declares that slot, so the registration threw and the whole loader entry failed — breaking the exact mode the developer switch exists to provide. Every one of the contributing packages now waits for its declaration, which is what makes a composition without the workbench root a supported mode rather than a crash.

The official browser lane pins `defaultUi: official` for the same reason the shipped roster pins `workbench`: those scenarios verify the official Web product, and a scenario that means to test the workbench must ask for it.

`qs.status` and `qs.overlay` carry occupants now: a connection strip with a manual reconnect and a toast host behind the `qsToast` service. Dialogs deliberately bypass that host, because a native `<dialog>.showModal()` reaches the top layer on its own. The developer switch has both entries: the top bar hides its button entirely when the deployment does not enable it, and the official sidebar's footer slot carries the return entry.

The [official source change list](../../../../../qishu/官方源码改动记录清单/00-登记规则与索引.md) is the authority for which official files this family touches and which verifications have actually run.

The independent Schedule catalog reads the official projection and stays disabled in the default bundle. Its opt-in patch enables both UI contributions with one Schedule owner. The catalog portals into its own `.qs-root` so theme variables remain inherited without copying palettes onto `body`; session switches destroy the open catalog and its display clock. This presentation does not acquire reminder execution or mutation ownership. Local timestamps include their UTC offset and the original UTC value, because a daylight-saving overlap can give two different instants the same local clock reading.

Goal views share the official `goalPresentation` provider. A caller may carry its observed GoalRef through mutation actions so Host CAS rejects edits against a replaced revision; omitted refs retain the official current-projection behavior. Connection resets invalidate the previous process activation before rereading it. This interface does not add a Goal executor or another command-input Definition; the independent Qishu Goal consumer captures edit revisions and requires explicit refresh after a conflict. Creation submits literal objective text to goals.create instead of interpreting it as a slash command. Clear confirmation captures both the displayed objective and its GoalRef; it never substitutes a newer projection revision at submission. Cancel and Escape have no mutation effect, and session or goal replacement discards the confirmation.

GoalError implements the shared Remote failure fields while retaining its HarnessError base. The Gateway uses structural error identity, whereas tool-result metadata and command consumers rely on the existing domain constructor; replacing that base would lose tool error codes. The pure Goal type outlet carries the error-map augmentation to both programs. Real Web Host calls assert that stale edit, pause, resume, complete, and clear requests return GOAL_STALE_REVISION without appending a goal/change or replacing the newer objective.

The Qishu composer exposes a strict Session takeover chain around the ordinary editor. Domain presenters elect from the official Session and pending-interaction snapshots, not independent read-only flags. A takeover releases the editor's trigger consumer; the shared input machine retains the draft. The no-Session path renders its fallback without resolving a strict Session scope.

The independent Qishu subagent presenter uses the official catalog observer and complete child addresses. Expanded branches release observation on collapse, selection change, and unmount; diagnostics never become navigation links. Browsing an ancestor catalog changes its observation root without selecting that ancestor; selecting a sibling uses the returned complete child address. Directional keys target healthy navigation buttons and leave native form controls alone. Its takeover selector follows the official one-shot and parent-unavailable conditions, preserving the ordinary Stop action for running continuable children.

The Qishu workspace selector uses the existing uiWorkspace navigation owner. It does not recreate blank-session reuse or navigation supersession. A local in-flight lock prevents repeated choices; only mounted presenters publish completion or failure state. Directory adoption remains owned by the separately composed picker flow.

Explicit Qishu session creation captures the selected session’s registered Workspace membership before dispatch. It supplies that Workspace identity to the official create operation; later selection changes suppress navigation without rewriting the accepted request’s working directory.

The Qishu conversation presenter declares the welcome workspace slot while the workspace presenter contributes its selector. Both entry points delegate navigation to the existing service and derive selection from its Session snapshot. Parent-slot disposal withdraws the welcome contribution without removing sidebar navigation.

Directory entry owners share one request controller and expose distinct child slots. Each callback captures a request identity; cancellation, another Session selection, occupant withdrawal and entry disposal invalidate it. Host workspace registration may finish after withdrawal, but the shared navigation beforeOpen callback rejects a withdrawn request before selecting its session. Picker components receive the request identity alongside the official open/busy/outcome parameters and must discard their obsolete native or browse completions.

The independent Qishu native picker contributes both directory-flow occupants and delegates the OS operation to uiWorkspace. A promise is retained per request identity so effect replay does not launch two dialogs. Mounting during adoption does not reopen the chooser. Withdrawal and unmount discard callbacks; cancelling a QS entry does not terminate the native Host dialog because the existing Client method exposes no per-request cancellation. Web tests replace only the OS capability result and retain real workspace persistence and navigation.

The independent Qishu browse picker uses Host-returned directory addresses without platform-specific path concatenation. Each open request owns abortable scans and ignores late results. Directory creation cannot be undone by closing the view; its late result loses navigation rights. Failed scans disable adoption of the previous listing, while localized alerts omit Host diagnostic details.

Qishu shell layout persistence uses a versioned allowlist containing only panel dimensions and visibility. Runtime viewport state, request identities and recovery notices never enter the record. Unversioned geometry is accepted for migration; unsupported versions and invalid fields fall back visibly. Browser storage failures retain usable in-memory state and do not surface raw browser diagnostics.

The panel layout-record codec stores addresses and geometry rather than live TabDomain occurrences, resource content, navigation parameters or undo history. Its parser reconstructs allowlisted fields and bounds input size. Valid JSON does not establish resource ownership or an installed presenter; storage and restoration must apply those checks through the official owner before publishing tabs. Browser storage is integrated through the QS session seat.

The official sidebar store owns a restore action that publishes an absent Session surface atomically through its existing subscribers. Docking operations allocate fresh identities; TabDomain sees only final records, and its existing close and owner-disposal paths release their pins. An existing surface rejects restoration so persisted preferences cannot overwrite live navigation. QS owns storage access and address authorization.

QS session seats persist versioned layout metadata and restore through the official owner only when their surface is absent. The official file-address parser and current tab/body registrations filter restored entries before any resource is pinned. Missing entries and bounded geometry produce visible recovery notices; storage errors retain the live layout. Writes follow the shared official store even while the QS seat is absent; deleted-session cleanup remains an explicit gap.

Panel-layout logout cleanup observes the optional QS login service through a disposable Cordis injection. Only an authenticated-to-signed-out transition clears the owned key prefix; initial signed-out state retains records for refresh restoration. Each persistence read and write checks current login state, preventing a retiring seat from recreating cleared records. Storage refusal is best-effort and never blocks logout; this browser preference mechanism is not authentication.

Viewport fitting is one official store intent because individual resizeFloat gestures raise and focus their panes. The owner restores the pre-adjustment focus and stacking in the same commit. QS coalesces resize notifications and cancels pending frames when the session seat unmounts.

The official presentation service exposes observeLayouts as a read-only committed-layout feed. It replays existing surfaces, ignores unchanged layout references, contains consumer exceptions and releases store listeners with its owner. QS keeps one save owner per mounted seat and delegates absent-seat commits to a root observer; both paths check current login state, so sign-out cannot be undone by background saving.

QS layout controls follow the prototype while mutations use official intents. The Move earlier button changes the active docked tab’s position without recreating resource occurrences; first, empty and floating positions disable this action. Keyboard equivalents for other drag gestures remain separate acceptance work.

The Conversation owner exposes its existing store handle and target activation through conversationPresentation. Shared View selection must reuse that handle rather than create a second persisted draft or focus request. A QS View roster must exclude official-only presenters; access to the source target does not itself deliver a QS trajectory view.

The QS reading host consumes conversationPresentation through a disposable injection. Its alternative View roster comes from QS registrations, so an official-only presenter cannot appear through source availability alone. Removing a selected presenter displays Chat without erasing the stored preference. Pending interactions and input remain sibling seats; only the reading body changes.

The independent QS trajectory plugin reads the official trajectory target and unregisters when that target is removed. Request context mounts only when expanded and renders as React text. The visual authority is qishu/prototype; official components supply behavior and lifecycle references, not the workbench appearance. Request cards do not imply support for message, tool-result or media records.

QS reading tabs separate keyboard focus from view activation. Moving focus cannot activate a target or replace the reading body; native button activation commits the view. Request token counts come from recorded usage, preserving missing counts separately from zero and rejecting nonfinite or negative values.

Pending interaction cards have a separately bounded scroll region. A visible approval or question reserves reading height and bounds the input zone, preserving access to view tabs during a long form. The form remains in its single session seat when the reading target changes.

The pending seat owns focus recovery only while its form owns focus. Settlement restores the prior DOM control, falling back within the current stage to input or a focusable heading. A session change clears this ownership, and focus explicitly moved elsewhere is never reclaimed.

A pending request disappearing produces a session-scoped status notice without an answerer or success claim. Remote cancellation can also mean transport or owner lifetime ended, so the view cannot equate every removal with another client answering. New requests hide the old notice.

The QS trajectory history ledger displays the official loaded event-node sequence separately from request prompt snapshots. A ledger is not a reconstructed effective model context, especially across compaction or partial history. Record bodies mount only after expansion, and unsupported content exposes a limitation rather than raw internal objects. Empty successful pages with remaining history expose a localized manual-retry notice in both reading views. The shared history state determines lack of progress; automatic retry must remain paused to avoid repeatedly requesting the same window. Physical stream recovery can replace a history window without reopening the Session object. Pending backwards pages therefore capture a window revision, and the Session advances paging identity and releases busy state on every replacement. A whole-stream abort signal cannot substitute for window ownership.

Trajectory image child-slot ownership belongs to the QS trajectory plugin; the attachment plugin imports its declaration and contributes independently. Authorized image loading and URL cache ownership stay with the official session service.

QS trajectory reading state is keyed by official SessionBinding in a WeakMap. It retains offsets and expanded record identities, never message content or image bytes; view unmount removes the scroll listener before another view takes ownership.

Tool inspection is an optional trajectory contribution to the tool-owned action slot. It reuses conversationPresentation target activation and the shared store focus request. The tool plugin does not depend on the trajectory implementation; missing target registration removes the visible action.

The QS settings shell mirrors ui-settings-general as an independent plugin. Its section, action, general-row and onboarding slots are QS-owned; settingsScope remains the only configuration authority. A root native dialog supplies modal focus. A loopback-only document action consumes hasDocument without exposing a path; its pending result belongs only to the mounted action instance.

The independent qs-locale presentation subscribes to the official LocaleRuntime and delegates its selection command. It owns no language registry or preference store; a Host read-only mirror disables durable selection, while memory connections display temporary scope. Immediate application is not a persistence acknowledgement.

The independent qs-ui-theme presentation registers appearance and font-size rows against the same official ThemeRuntime. Theme events and settings writes remain official-owned; disposing the presenter does not recreate or release the service.

The qs-ui-settings-plugins navigation retains visited tab mounts so page-owned drafts survive switching, while removed contributions release their pages. Its parent/child registration and DOM navigation are tested locally; Web composition includes the read-only inventory tab; Shell and AgentLoop numeric cards are connected; WebSearch and SubagentModelSelection cards are connected.

The independent qs-ui-settings-plugin-inventory contributes a lazy, read-only tab to qs-ui-settings-plugins. It delegates to the official inventory RPC and preset display resolver. Request effects ignore late settlement after disposal; metadata and conditions render as text. Global enablement, preset composition and observed runtime phase remain separate facts.

The plugin configuration directory dispatches a card only when its namespace exists in the official describe mirror and its keyed contribution is mounted. Missing initial state, failed reads, unavailable connections and an empty served directory stay distinct. Numeric cards use the initial edit revision, preserve drafts on conflict and require explicit adoption of the current revision before retrying against it. Reset removes an override rather than writing a copy of the base value.

QS configuration writes must retain the editor revision and consume an explicit Remote result. The local card writer refuses stale completion to overwrite a newer shared mirror revision and does not infer success from a resolved void mutation. Disposing a presenter suppresses late UI adoption but cannot undo a Host write already sent.

The QS WebSearch card presents configuration and credential acknowledgements independently. Only acknowledged drafts are cleared; retries retain the original credential reference. Credential literals stay local to the mounted editor and are cleared on card unmount, discard, connection reset and disposal. The credential service remains the authority for writable/configured metadata.

The independent qs-ui-permission-presets decorator reads the current permission projection and delegates machine-valued commands to the official session. It never treats a menu selection as committed permission state. Built-in labels match the Host product names exactly before localization; operator-supplied labels remain unchanged. New-session defaults are a separate settings operation and cannot imply a change to an existing session.

Default permission confirmations are bound to both the settings revision and the current connection epoch. A reconnect can retain the same revision, so revision comparison alone cannot authorize a confirmation from the old connection. Settings write results remain separate from current-session command results.

Root presentation shadowing does not withdraw every official child declaration. Command decorators therefore use explicit priority for independent QS overrides, while same-priority duplicates remain errors. The QS permission override follows its settings slot lifetime; removing the QS root restores the official decorator without recreating the shared command service.

The QS agent-preset directory retains broken entries for management and preserves the Host effective default separately from the picker visibility policy. Directory-opening capability is read independently, so its absence does not erase usable presets. Only the newest read in the active lifecycle can publish a roster.

Preset policy controls write individual settings fields with the displayed revision. A reset invalidates pending acknowledgements without implying cancellation of Host persistence; reconnects must read the authoritative settings again. Stored defaults and effective roster defaults remain distinct when deployment policy hides the picker.

Staged preset selections must be rechecked against the current roster before reaching a blank session. An asynchronous selection reply belongs to both its connection generation and captured session id; neither a different active session nor a remounted controller can inherit it.

Saving a preset policy and synchronizing an existing blank session are separate Host operations. Capture the blank session before the settings write, then use the refreshed effective default; the saved default can differ when picker policy is disabled. A synchronization refusal must not report the already-persisted settings write as failed.

Preset selection and message submission are independent RPCs. The QS composer consumes a session-addressed preparation source instead of assuming list-change subscriptions settle before submission. Pending preparation preserves the handoff; failure cancels automatic submission and retains the draft. The preparation target is captured when selection starts, not inferred from the current navigation later.

An unloaded preparation provider cannot acknowledge a successful preset operation. The composer retains an interrupted contribution until a replacement explicitly retries; idle registration and stale RPC replies cannot release a cancelled first-send handoff.

QS model selection reuses the official modelDirectories resolver and exposes a separate composer slot. Its /model decorator also targets existing client-owned commands, with the original contribution availability checked before decoration. Both menu and Enter apply the same effective UI and attachment policy; disposal restores the original contribution.

Command handlers may synchronously open a popup. The input shell clears old transient UI after entering the locked phase but before running submit effects, so cleanup cannot dismiss the new popup.

Model selection failures include transport rejection as well as RPC error envelopes. The shared directory releases its selecting status on rejection only while the request still owns the current generation; a response from a disposed scope or previous connection cannot rewrite the current status.

Alternate model-settings presentations consume the official modelsSettings access service. It publishes the existing provider directory, settings and credential operations, and welcome controller; independent views do not create competing model configuration or acknowledgement stores.

QS model settings registers its own settings section and provider-card/footer extensions while reading modelsSettings.face. Provider credentials are displayed as confirmed, missing, or unknown; a live provider without an explicit credential reference retains its native authentication status.

Provider configuration and credential storage are separate commits. The QS provider writer acknowledges the new settings view before storing a key, preserves partial success, and requires retry diffs against the acknowledged revision. Disposing the editor prevents subsequent credential writes without claiming to roll back a Host request already sent.

The connection editor changes only its displayed endpoint and credential-reference fields, retaining hidden configuration. Blank key inputs preserve stored credentials. Native-authentication routes can be materialized as empty profiles; unsupported adapter families retain a visible deployment-configuration notice.

Provider removal keeps credentials by default because a configuration entry does not prove exclusive ownership of a secret. A user can select deletion of a writable conventional reference only when the current directory has no other reference to it. Confirmed credential removal precedes the revision-fenced configuration unset and is not repeated after partial failure; this protects a credential recreated before retry.

Model-array edits preserve unknown per-model fields and materialize only after an explicit edit. Reset uses deployment or schema defaults rather than the effective value that still contains user overrides. Configuration acknowledgement clears the submitted model delta before credential work; serialized object-key order cannot determine whether a committed array must be sent again.

Model discovery is a read-only operation over draft fields. A credential supplied for interrogation is not persisted, candidates require explicit adoption, and adoption preserves models edited while a query was in flight. Each request-field generation owns its reply; changing endpoint, protocol, route or key invalidates older outcomes instead of letting them replace the new candidate list.

Custom-provider creation uses the adapter schema’s protocol enum and the revision captured when the draft opened; the route is not used for discovery before it exists. Once the profile commits, credential-only retry cannot recreate it. Late creation acknowledgement must not replace an already observed higher settings revision before checking where a key would be stored.

Only hand-declared pi-ai routes expose route-level protocol editing; built-in catalog models may use different protocols. The editor changes name and protocol through addressed field operations while keeping the route ID fixed. Endpoint interrogation uses the draft protocol, and a settings acknowledgement clears the submitted protocol delta before any credential retry.

The QS welcome-notice onboarding registration consumes the same versioned official copy and acknowledgement controller as the official UI. Confirmation failures remain retryable; disposed views ignore late load and acknowledgement responses. The independent DeepSeek credential step follows shared-directory readiness, preserves failed drafts and ignores late responses after disposal. The shipped Web bundle mounts the QS model settings plugin alongside the unique official state owner. Keyless real-Host browser coverage verifies acknowledgement, write-only credentials and endpoint persistence across reload; custom-provider CRUD preserves failed drafts and independent credentials. Onboarding waits for its authoritative facts before opening a dialog, preventing configured reloads from taking focus.

The conversation presentation access also publishes the existing submission policy: the official settings row and alternative consumers share one busy-Enter observable, setter and gesture resolver. The QS composer resolves each bound submission against the current Session and this shared policy; first-message handoff remains queued. The QS composer-enter row contributes the same preference to General Settings and releases only its presentation on unload.

The Chat owner publishes its existing transcript-view observable and setter as chatPresentation. Alternative transcripts must consume this policy without creating another settings controller; publishing the access alone does not complete their rendering or settings rows.

The QS viewport subscribes to the shared mode: Normal renders process members without the compact controller, while switching back to Compact preserves per-turn expansion. Final-answer inline reasoning uses the same completed-turn disclosure state only when Compact mode and the process readiness conditions hold; answer text and independent reasoning disclosure state remain intact.

The QS transcript-view row corresponds to the official ui-chat registration and contributes to General Settings at order 12. It uses the shared observable and setter directly; unloading removes the row without resetting the preference.

The QS process controller and member visibility use one readiness predicate: a closed matching turn, a known answer anchor, complete history and existing process activity. A controller cannot be displayed when its members are deliberately kept visible by these protections.

The shared Chat presentation passes useSearchableHidden as a service value, preserving client module isolation. QS process members remain mounted and delegate beforematch and focused-content protection to this official hook; final reasoning uses the same turn-level reveal action.
