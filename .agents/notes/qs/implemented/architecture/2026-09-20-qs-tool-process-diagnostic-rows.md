# Agent Note: Qishu tool, process, and diagnostic rows

Status: implemented

English | [中文](2026-09-20-qs-tool-process-diagnostic-rows.zh.md)

## Problem

The workbench transcript needed the tool-call tree, the turn process and closing footer, and the retry/error/truncation diagnostics that the second-priority plan assigns to components C1–C3. The official presentation of those rows lives in `packages/client/ui-tool` and `packages/client/ui-chat`, neither of which the workbench can consume as a view.

Three facts constrain the reimplementation. A command's exit status is not a structured field: the shell tool appends `[exit code: N]` or `[killed by signal: S]` to the result text, and a spilled result replaces that tail. Process folding belongs to the turn projection, not to a row: official Chat hides a turn's process members inside `[processStartSeq, answerAnchorSeq)` once the turn closed. Row components receive frozen props and never a context, so a tool view cannot reach the session-authorized image loader or the fold state on its own.

## Decision

`@deepseek-ai/dsh-qs-ui-tool` registers the `tool-call` row on the transcript's row slot and declares the `qs.tool.call.toolview` child slot; eight sub-plugins register the wire keys they own. Each view model is a pure function over the durable payload and returns `undefined` for a payload that does not match the documented contract, which sends that call to the shared generic card; a view never partially interprets an unknown payload and never renders an empty row.

Exit status is read only from the official tail markers, and "no marker" is reported as unavailable instead of success. A spilled result reports that the status is not in the loaded text.

Recorded failure takes precedence over valid request arguments: a failed todo write uses the generic result card. An authorized image URL does not prove successful browser loading or decoding; both loader rejection and the image error event produce a visible failure notice while retaining the result text.

Question pairing and answer counting are independent: valid result entries support a count even when their IDs cannot pair with the request. Invalid result text supports neither and stays visible through the generic card, preserving the distinction between an unknown result and zero answers.

Session-scoped capabilities travel as row owner props: the transcript owner issues the image loader per binding through `uiConversation.imageUrl` and creates one fold store per binding, so rows read and write the fold state without holding a context. Process folding uses the official window bounds and independent-kind list, and is applied at the row seat, so revealing a fold re-renders the seats through the same store subscription.

Folding and its disclosure share the activity predicate, including uncounted external process and inline reasoning. An incomplete history window cannot hide process members because the controlling process row may not be loaded.

Diagnostics are three separate registrations. The retry row states the official `retryState` with its attempt counters and offers no timer and no action; an exhausted retry is stated by the turn's own error row, which is where the durable failure lives.

Collapsed summaries never include raw command arguments. Obvious credential headers, environment assignments, and URLs with user information, query strings, or fragments are omitted from automatic summaries; raw details remain available on explicit expansion. This filter does not recognize every secret in arbitrary free text.

Tail diagnostics share a weakly keyed index per immutable node-array snapshot. A changed node array builds a fresh index, so additions, removals, and session switches cannot reuse stale facts; querying another tail within the same snapshot does not scan the transcript again.

While a turn is running, its step coordinate comes from the latest step in that turn’s official node location; once closed it uses the final answer step. Missing locations and mismatched turns never supply a guessed coordinate.

Generic arguments and non-text JSON results are parsed or serialized only after their own disclosure opens. Closing that disclosure removes its body; error text remains directly visible. Raw arguments wrap at character boundaries without changing their text, reducing layout work for long JSON strings. Large complete text results still cause browser long tasks; wide subcall trees require separate performance validation.

History paging preserves the selected row through subsequent layout changes until the user scrolls or submits. The transcript temporarily disables native scroll anchoring to avoid duplicate adjustments and restores the original style on disposal.

History loads automatically when the top sentinel enters the transcript scroll container. The official session controller owns request serialization and history state. Disconnects, loading, cancellation, failures, and pages without progress suspend automatic loading; manual retry remains available when connected. Disposed observers cannot request another page.

Compaction rows consume the official automatic checkpoint and correlated manual-command projections. Summaries mount only while expanded, missing estimates remain unavailable, and failed or checkpoint-less command settlements retain their full text. The marker never renders the model checkpoint envelope or removes the original conversation history.

The composer context panel uses the official session projection seat and token-meter types, without creating a second meter service. Unknown capacity or sampling stays distinct from zero. Composition and model-switch timing caveats are visible on expansion; these estimates never authorize, block, or price a request.

Command rows read running and settled states from the official command projection. Names missing from the history window use a generic label, arguments are not echoed, and complete results mount as plain text only while expanded. Rendering a result never re-executes the command.

The composer aggregates independently held command and confirmation freezes with session-creation handoff. Each release removes only its own holder; disposal invalidates late acquisitions and releases. Expanded context panels and queues scroll within the input area so they cannot consume the entire transcript viewport.

The independent qs-ui-input-trigger plugin renders command candidates using the official session controller. Its input bridge reads the official draft revision, tracks the visible caret, suspends matching during IME composition, and arbitrates menu keys before ordinary submission. The composer owns the consumer lease; the menu owns only its binding and subscriptions.

The independent qs-ui-commands presentation reuses the official popup controller and renders risk confirmation in a native dialog inside the Qishu theme root; browser modality contains focus while the controller owns acknowledgement and execution. Input freezes belong to the open view; unmount dismisses the controller without returning focus, preventing late settlements from consuming a different draft. Dismissal never promises to reverse a business operation already sent.

The qs-ui-message-feedback plugin contributes durable-message actions and a session form through the shared official feedback presentation. The transcript owns the closing-message action slot and supplies only persisted message identities; streaming partials cannot be rated. Feedback acknowledgements do not stand in for task notifications.

The Qishu right sidebar shares the official store handle and TabDomain. Numbered shell expansion requests are distinct from panel-state reports, so navigation can reveal content without a stale shell preference overwriting it. Keyed body/title slots preserve record identity and occurrence signals; session changes and QS unload do not dispose official resource ownership. Shared docking components handle layout gestures; missing business views remain visible limitations.

The file-tree presentation exposes one store handle and memoizes its Remote face by the store instance actions. Alternate bodies share request generations as well as state; a view switch cannot let an older directory response overwrite a newer refresh. Tab abort remains the lifetime authority.

The document-preview presentation likewise shares the official store and one injected face per store instance. Paged and byte reads retire each other through the same generation owner; changing a renderer or refreshing in another view cannot publish an obsolete response. Its registry subscription is shared without duplicating renderer metadata registrations.

## Alternatives considered

- Rendering `openFile`, `inspectCall`, and home abbreviation from reconstructed addresses would fake capabilities whose owners are the sidebar inspector (C9), the trajectory view (C17), and Host account facts.
- Hiding process members from inside the process row would leave the member rows mounted and visible, because the row does not own the transcript's node order.
- A live countdown on the retry row would present a local clock as schedule authority, which the prototype explicitly forbids.

## Consequences

The transcript package now owns two session-scoped row capabilities; any new row that needs one must add it to the same owner share rather than reaching for services. Tool views degrade to the generic card whenever a recorded payload stops matching the contract, so a Host-side change to tool arguments or `meta` shows up as a limitation notice rather than a blank row.

Cross-package row keys stay discoverable: the generated client slot catalog now records `qs.tool.call.toolview` and the `tool-call` row key. Opening files, trajectory inspection, home abbreviation, and the desktop/narrow-width visual pass remain unimplemented and are recorded in the [M1 acceptance report](../../../../../qishu/PRD/1-AI工作台/复核测试/32-第二优先M1工具过程诊断验收.md).

The document preview owner publishes one PDF page store and the existing worker and canvas operations through `documentPdfPresentation`. Alternate PDF bodies own their mounted documents and cancellation signals; view switching retains tab preferences without sharing live canvas tasks. A page retry creates a fresh canvas so the cancelled attempt cannot write into its successor.

The deliverables plugin remains the single owner of successful mutation facts, explicit delivery declarations and native-open requests. Qishu replaces its closing-turn and present-tool presentations through independent slots and the shared deliverablesPresentation service. Preview requests use Session-scoped file addresses; native actions require an explicit gesture and preserve durable event/index coordinates.

Qishu assistant rows subscribe to the official Turn location data through their slot hook context. Only the closed Turn’s final Assistant sequence receives the optional official file-mention vocabulary; delayed tail publication updates links without a whole-transcript scan. The provider continues to reject unknown paths and ambiguous basenames, and the opener resolves paths under the viewed Session.

Existing image attachments render through a dedicated Qishu attachment plugin. The transcript alone declares the message-image slot and delegates its renderer to user, steering and context rows. Tool image results have a separate contribution. Session-authorized loaders own byte reads and URL lifetimes; views ignore replaced or unmounted asynchronous results. New uploads remain outside the second-priority scope. Original previews use a body portal, focus the close button, close on Escape or backdrop press, and restore the opening element on unmount. Ordinary file metadata belongs to the transcript presenter and retains its original position among images; opaque attachment IDs never become navigation URLs.
