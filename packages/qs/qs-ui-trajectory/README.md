---
description: "Request trajectory over official recorded facts."
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-ui-trajectory

English | [中文](README.zh.md)

## Summary

Inspect recorded request context in the Qishu workbench.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

This independent ui-trajectory counterpart registers in qs.stage.view while the official trajectory target exists. The Web profile loads it independently.

<a id="understand-the-implementation"></a>
## Understand the implementation

The view reads official request snapshots and Session paging. Target removal unregisters the view. Context is mounted only after expansion and rendered as text. The plugin does not duplicate event Definitions or target builders. No invariant companion is published because projection ownership stays with official registries.

<a id="model-experience"></a>
## Model Experience

### Browser presentation

#### What the model sees

The `trajectory` target supplies recorded requests. This view adds no model messages or tool definitions.

#### Token effect

No additional prompt tokens.

#### KV Cache effect

The view does not construct provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Request cards, recorded system/tool context, per-request token counts, recorded first-token latency and history loading are implemented. Missing or invalid usage counts display as unrecorded; zero remains zero. First-token latency joins the assistant timing by result sequence, so failed retries cannot inherit a later result; missing timing remains unrecorded. Loaded user, follow-up, context, assistant and tool-result text records and compaction summaries are available in a lazy history ledger. The ledger is not a reconstruction of an individual model request. Images delegate to the optional QS attachment plugin through a session-authorized loader and mount only when a record expands. Missing image presentation shows a limitation notice. File names and byte counts are displayed without unsupported open/download actions. Request-result navigation expands and focuses the loaded assistant result or compaction summary by its recorded sequence; absent results stay unavailable. Loaded-turn navigation focuses the first recorded request of each turn and omits unowned manual compaction. Reading positions and expanded records persist in the official session binding lifetime, separately from Chat. File attachment access, full metrics, virtualization and complete cross-view interaction acceptance remain unfinished. Expanded request details also show recorded compaction summaries, raw output and failure information. Authentication failures use localized guidance instead of the raw provider authentication response. Live assistant blocks and running tool hierarchies use the same official trajectory snapshot; completion removes the transient presentation. Official cross-view tool-call focus requests expand the loaded ancestor chain, focus the target and acknowledge only after applying it; missing history retains the request with a visible notice. This is not full W9 acceptance.

Tool cards expose an inspection action contributed by this plugin. It activates the official trajectory target and sends the call identity through the shared conversation store; unavailable views hide the action. The tool plugin owns the action slot, so removing either plugin does not leave a separate draft or duplicate target.

### Dev Note

Official registries own request projection and paging; the QS plugin owns presentation only.

When an earlier-history page succeeds without adding records while more history remains, a localized status explains the empty result and keeps manual retry available. The official historyLoad state owns this decision; the presentation does not infer exhaustion or start another automatic request.
