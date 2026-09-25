---
description: "Qishu workbench transcript: keyed chat-node rows, the interaction chain host, and history paging."
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-transcript

English | [中文](README.zh.md)

## Summary

This plugin corresponds to official ui-chat, including its viewport and scroll-position ownership. It does not own the conversation composer or execute tools.

Read user messages, assistant output, and pending interaction cards in the workbench. Assistant prose uses the official Markdown renderer, including code blocks and sanitized links; unrecognized records remain inspectable.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

Mount `@deepseek-ai/dsh-qs-transcript` with the other Qishu plugin rows in the [Web bundle](../../bundle/web-app/cordis.patch.yml). The package has no deployment configuration fields.

System prompts, reference context, reasoning, and unknown extension payloads start collapsed and expand into bounded, wrapping text panels. Closed-turn process rows show recorded activity counts; footers show completion and exact token totals when available, without repeating the answer. These disclosures affect presentation only and do not remove context from model requests. Unknown payloads are serialized only while expanded; closing releases their formatted display text.

The viewport consumes the official shared transcript preference. Normal mode keeps process members visible and hides the compact disclosure controller; returning to Compact preserves each turn’s manual expansion state. The General Settings transcript-view row reads and writes that same official preference. In Compact mode, the final answer’s inline reasoning follows the completed-turn process disclosure; the answer text stays visible. In Normal mode, or while the turn or its history is incomplete, reasoning remains independently expandable.

A process disclosure appears only after the turn closes, its answer anchor is known, the projection matches the turn, the visible history is complete, and process activity exists. Otherwise process members remain visible without an inactive controller.

Sending a message or steering restores following. Passive output and historical prepends preserve a reader who has scrolled away. Programmatic scrolling is immediate, and its delayed scroll events do not cancel following when content grows.

History loading and failures have visible status; retry reconnects the official transport. Each Session binding retains its reading position in memory across view switches. Loading earlier history preserves the visible row anchor. Whole-message copying includes user text or assistant prose, excluding reasoning.

User text and steering text follow the official content font-size preference while retaining their prototype size offsets. Assistant Markdown uses the official typography tokens; code blocks keep their fixed code size.

<a id="understand-the-implementation"></a>
## Understand the implementation

Folded process members and final reasoning stay mounted with the official searchable-hidden hook supplied by chatPresentation. A beforematch event reveals the owning turn; content holding focus is not hidden. Validation of the browser’s native find UI remains separate from programmatic event tests.

<details>
<summary>Implementation internals</summary>

Rows subscribe to keyed chat-node sources; history reads the Session snapshot. Resize observation covers output and interaction cards. The official conversation projection owns durable records, so this presentation package publishes no runtime invariant companion.

The row renderer table covers every local RowKey at compile time. Reading-position restoration retries after content growth when the browser initially clamps scrollTop.

</details>

No runtime invariant companion is published because the official services own the authoritative session data and this package only presents it.

<a id="model-experience"></a>
## Model Experience

### Browser presentation

#### What the model sees

`@deepseek-ai/dsh-qs-transcript`: this browser presentation delegates user actions to official services without constructing model requests.

#### Token effect

This package adds no prompt or tool-schema tokens of its own; official services handle user-submitted content.

#### KV Cache effect

None; neither entry assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Message images delegate to qs-ui-attachment. Ordinary file cards show names, types and sizes without open or download actions, matching official Chat. Unsupported non-text blocks retain a visible limitation notice. Markdown supports HTTP(S) images and absolute POSIX/Windows local paths through the official authenticated file API; relative paths remain unsupported.

Row dispatch follows live, non-abdicated slot keys. Late contributions become renderable without editing a built-in whitelist; removing a contribution restores the unknown-row fallback. Paging failures are read from `historyLoad`, and interaction cards belong to the fixed composer stage.

Process folding requires a closed, matching turn with an answer anchor and expandable activity. External process and inline reasoning remain expandable even with zero activity counts; incomplete history keeps loaded members visible.

Tail diagnostics share a weakly keyed index per immutable node-array snapshot. A changed node array builds a fresh index, so additions, removals, and session switches cannot reuse stale facts; querying another tail within the same snapshot does not scan the transcript again.

While a turn is running, its step coordinate comes from the latest step in that turn’s official node location; once closed it uses the final answer step. Missing locations and mismatched turns never supply a guessed coordinate.

History paging preserves the selected row through subsequent layout changes until the user scrolls or submits. The transcript temporarily disables native scroll anchoring to avoid duplicate adjustments and restores the original style on disposal.

History loads automatically when the top sentinel enters the transcript scroll container. The official session controller owns request serialization and history state. Disconnects, loading, cancellation, failures, and pages without progress suspend automatic loading; manual retry remains available when connected. Disposed observers cannot request another page.

Compaction rows consume the official automatic checkpoint and correlated manual-command projections. Summaries mount only while expanded, missing estimates remain unavailable, and failed or checkpoint-less command settlements retain their full text. The marker never renders the model checkpoint envelope or removes the original conversation history.

Command rows read running and settled states from the official command projection. Names missing from the history window use a generic label, arguments are not echoed, and complete results mount as plain text only while expanded. Rendering a result never re-executes the command.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

Validation status is recorded in the [review repair log](../../../qishu/PRD/1-AI工作台/复核测试/02-复核修复与全量验证.md).

</details>

The turn-tail renderer declares qs.chat.assistant-actions and passes the official closing messageId only when it exists. Interrupted partials without a persistent identity expose no message action slot.

The closing row also declares qs.chat.turn-tail with the official Turn location and closing sequence. Independent file presentations consume this chain without rebuilding Session events.

Final-answer inline-code file references use the optional official chatFileMentions provider. Each row subscribes to its own turn-tail data; a closed Turn and matching final-assistant sequence are required before links appear. Unknown paths and ambiguous basenames remain plain code. File navigation uses the viewed Session and official sidebar resource router.

When an earlier-history page succeeds without adding records while more history remains, a localized status explains the empty result and keeps manual retry available. The official historyLoad state owns this decision; the presentation does not infer exhaustion or start another automatic request.
