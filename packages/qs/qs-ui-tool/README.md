---
description: "Qishu workbench tool presentation: the tool-call tree, eight per-tool sub-views, and the keyed tool view slot."
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-ui-tool

English | [中文](README.zh.md)

## Summary

This plugin corresponds to official ui-tool: the tool-call tree inside the transcript and the per-tool view registry. It reuses the official durable call/result payload, the shared presentation primitives, and the official command and permission services; it does not execute tools or read local files.

Tool calls render as expandable rows whose state comes from the recorded call: running, completed, failed, or interrupted. Each call dispatches by Wire tool name to its own view; an unclaimed name — including a result whose call head fell outside the loaded window — keeps the generic card instead of disappearing.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

Mount `@deepseek-ai/dsh-qs-ui-tool` with the other Qishu plugin rows in the [Web bundle](../../bundle/web-app/cordis.patch.yml). The package has no deployment configuration fields.

Reading a write, edit, command, search, web, todo, image, or question tool call shows the recorded summary, arguments, and result. A command's failure is read from the exit marker the official shell renderer appends to the result text, never inferred from the turn ending; output that was spilled, or a result with no exit marker, states that the status is unavailable instead of claiming success.

Sub-calls (programmatic tool dispatch) nest under their root call by `callId`, and an unknown or non-text result keeps its escaped source text as a bounded, selectable panel.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

The row registers the `tool-call` key on the transcript's row slot and declares the `qs.tool.call.toolview` child slot; eight sub-plugins register the wire keys they own (`bash` and `pwsh` share the shell view; `write`/`edit`, `grep`/`glob`, and `web_search`/`web_fetch` share their family views). Keyed dispatch uses the same entry-key mechanism the framework already provides, so removing a sub-plugin immediately returns those keys to the generic card.

View models are pure functions over the durable payload and return `undefined` when the payload does not match the documented contract; the component then renders the generic card, so a contract mismatch degrades to inspectable text rather than an empty row. Each view renders at most one nesting level for its own call; recursion and the depth cap live in the tree.

</details>

No runtime invariant companion is published because the official conversation projection owns the durable call and result records and this package only presents them.

<a id="model-experience"></a>
## Model Experience

### Browser presentation

#### What the model sees

`@deepseek-ai/dsh-qs-ui-tool`: this browser presentation delegates tool execution to official services without constructing model requests. Tool results shown here are the same durable records the model already received.

#### Token effect

This package adds no prompt or tool-schema tokens; tool schemas belong to the official tool packages.

#### KV Cache effect

None; the browser presentation assembles no provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- File opening and `~` home abbreviation remain unavailable. Paths are relative to the session workspace root. The independent QS trajectory plugin contributes a tool inspection action through `qs.tool.call.actions`; the action is hidden when the trajectory view is unavailable.
- Image results render through the session-authorized loader the host hands to rows. Without that capability the card states the limitation and keeps the text summary; URL loading and browser image failures show an error notice. Failed todo writes retain the error result instead of displaying the requested list as applied state.
- A call whose recorded arguments do not match the documented schema for its tool falls back to the generic card; the per-tool views do not partially interpret unknown payloads.
- Historical answers that parse but cannot pair with questions use the actual result entries for both answered and total counts. Unparseable results retain their original content in the generic card instead of reporting zero answers.
- An orphaned result (call head outside the loaded window) states that the arguments are unavailable and points at the transcript's own history control; the row adds no history action of its own.

Collapsed summaries never include raw command arguments. Obvious credential headers, environment assignments, and URLs with user information, query strings, or fragments are omitted from automatic summaries; raw details remain available on explicit expansion. This filter does not recognize every secret in arbitrary free text.

Generic arguments and non-text JSON results are parsed or serialized only after their own disclosure opens. Closing that disclosure removes its body; error text remains directly visible. Raw arguments wrap at character boundaries without changing their text, reducing layout work for long JSON strings. Large complete text results still cause browser long tasks; wide subcall trees require separate performance validation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

Implementation status for the second-priority milestone, including which prototype states are covered and which are deferred, is recorded in the [M1 acceptance report](../../../qishu/PRD/1-AI工作台/复核测试/32-第二优先M1工具过程诊断验收.md).

</details>

The public client type exports expose the tool-view slot to independent presentation plugins such as qs-ui-deliverables; the tool tree remains the slot owner.
