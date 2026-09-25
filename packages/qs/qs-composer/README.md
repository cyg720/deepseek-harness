---
description: "Qishu workbench composer: draft, send, stop, queue handling, and the no-session creation hand-off."
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-composer

English | [中文](README.zh.md)

## Summary

This plugin corresponds to official ui-conversation. It owns Stage, welcome, input and queue presentation; qs-transcript independently owns the Chat viewport and scrolling. The welcome area exposes qs.workspace.hero.agentPreset for the independent preset plugin.

Compose and send messages in the selected session, or create a session on the first send. Running sessions follow the shared busy-Enter preference; Ctrl/Cmd+Enter requests the opposite mode when steering is available. Queue rows can be edited, removed, or steered. Queue controls remain locked until the current operation settles. Failed creation keeps the draft and its reserved session identity. Holding Enter does not repeatedly submit the same draft.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

Mount `@deepseek-ai/dsh-qs-composer` with the other Qishu plugin rows in the [Web bundle](../../bundle/web-app/cordis.patch.yml). The package has no deployment configuration fields. Its composer-enter General Settings row shares the official busy-Enter preference and setter. Empty-draft Ctrl/Cmd+Enter steers pending messages through the official queue operation; command menus arbitrate modified Enter before submission. The send button names the resolved delivery mode while busy and updates with the shared preference and session state.

If a first-message handoff becomes blocked, its draft remains editable. Recovery requires another explicit send; reconnecting does not automatically submit the retained draft.

The input follows the official content font-size preference with a 1px offset; at viewport widths of 700px or less it stays at least 16px to avoid mobile focus zoom.

<a id="understand-the-implementation"></a>
## Understand the implementation

When a contributor unloads with unresolved preparation, the registry retains a session-specific failure and recovery instructions. An idle replacement does not clear it; a replacement must publish a new preparation attempt and settle it. The composer cancels the automatic first-send handoff and retains the draft, so later recovery requires an explicit send.

Independent QS plugins publish session-addressed preparation through qsSendPreparation. Pending preparation disables submission while retaining the first-send handoff; readiness resumes that handoff once. A reported failure preserves the draft and requires a new explicit send after recovery. Registry contributions and their subscriptions are released with their owners.

The session header declares qs.stage.header.actions for independent feature contributions. It is rendered only while a current Session exists; job data and control recovery belong to the jobs presenter and official Session service.

The welcome area is visible only without a selected Session or when its official list summary confirms it is blank; unknown or non-blank history keeps the transcript at the top. The welcome area declares `qs.workspace.hero`; the independent workspace presentation owns its selection and navigation. The conversation plugin only renders the slot.

<details>
<summary>Implementation internals</summary>

The client delegates sending to the official input machine. Cancellation and unmount invalidate pending creation before navigation; failed requests never prove creation succeeded. Session-owned notices and blocks remain authoritative. No runtime invariant companion is published because this adapter has no independent durable projection to compare.

First-send handoff waits for both the reserved Session and its input actions; another selected Session cannot receive the pending draft.

</details>

<a id="model-experience"></a>
## Model Experience

### Browser presentation

#### What the model sees

`@deepseek-ai/dsh-qs-composer`: this browser presentation delegates user actions to official services without constructing model requests.

#### Token effect

This package adds no prompt or tool-schema tokens of its own; official services handle user-submitted content.

#### KV Cache effect

None; neither entry assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Attachments and model selection are unavailable in this phase. The model label is read-only. A failed first send retries the same identity; cancelling does not delete a session the Host already created.

The session-scoped `qs.stage.pending` seat owns the `qs.stage.interaction` chain outside the scrolling transcript. Its pending request source stays authoritative when reading content changes. Drafts containing references or attachments remain visible but read-only in QS; continue editing them in the official interface. Plain-text command claims remain editable and submit through the official input machine; QS does not call a claim directly.

The context panel reads the official session pressure and composition projections. Projected tokens take precedence over the last request sample; missing samples or capacity show an unavailable notice. The panel labels composition as heuristic and warns that model switches may retain earlier sampling. It does not gate sends, determine billing, or initiate compaction.

The composer aggregates independently held command and confirmation freezes with session-creation handoff. Each release removes only its own holder; disposal invalidates late acquisitions and releases. Expanded context panels and queues scroll within the input area so they cannot consume the entire transcript viewport.

The composer host elects independent business replacements through `qs.composer.takeover`, using the official Session and pending-interaction snapshots. A selected replacement unmounts the ordinary editor and releases its input-trigger lease; all-decline restores the editor over the same official input machine. Without a selected Session the host renders only its fallback and does not resolve the strict Session chain.

A continuable child requires confirmed parent availability before editing or submitting. Unknown availability keeps input disabled without claiming the parent is offline. The independent Stop remains available for a running child; reconnecting to an available parent preserves the existing draft.

The Session reading seat uses the official conversationPresentation store for view selection and focus requests. It lists only registered QS reading views, falls back to Chat when a selected presenter unloads, and retains the saved preference for remount. Pending interactions and the composer remain outside the replaceable reading content. When a pending card disappears with keyboard focus, the seat restores its still-focusable origin or the current input/heading. User-directed focus elsewhere and session replacement suppress restoration. Removal of the current pending request leaves a localized status update in that session; the notice does not infer who answered or claim successful settlement and disappears when a new request arrives. Pending cards scroll within a bounded zone; a visible approval or question reserves reading space and limits the input zone so long forms cannot cover view tabs. Without the shared presentation service, Chat remains the fallback. The QS trajectory presenter is separate and is not supplied by this package. Reading tabs use manual activation: Arrow keys and Home/End move focus; Enter or Space selects the view. Each tab names the shared reading panel, and removing the focused view restores a reachable tab.

Reading view tabs stay at the top of the scroll container so switching views does not first discard the current reading position.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

Validation status is recorded in the [review repair log](../../../qishu/PRD/1-AI工作台/复核测试/02-复核修复与全量验证.md).

</details>
