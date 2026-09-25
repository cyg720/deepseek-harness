---
description: "Qishu workbench session navigation: list, switch, create, rename, archive, and local pinning."
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-sessions

English | [中文](README.zh.md)

## Summary

This plugin corresponds to the first-priority session browsing surface of official ui-workspace. It contributes through the child slot owned by qs-ui-sidebar; the official ui-session service is reused.

Browse, pin, switch, rename, and archive sessions from the workbench. Creation deduplicates concurrent clicks and does not replace a selection made while the request was pending.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

Mount `@deepseek-ai/dsh-qs-sessions` with the other Qishu plugin rows in the [Web bundle](../../bundle/web-app/cordis.patch.yml). The package has no deployment configuration fields.

Closing a management dialog stops its pending result from affecting a later dialog. A rename or archive already accepted by the server still completes and updates the official session snapshot.

Ctrl+K or Command+K opens a new conversation while the workbench session list is mounted. Key repeats, input composition, and an open modal dialog suppress this shortcut.

New session inherits the selected session’s registered workspace through its official membership. With no matching workspace, it uses the Host default. The explicit creation button creates a fresh session; selecting a workspace separately uses the shared blank-session reuse policy.

The welcome and sidebar workspace entries share the official navigation service and current-session snapshot. Either entry updates the other through that snapshot; unloading the conversation withdraws only the welcome contribution and restores it on remount.

The workspace selector reads the official Workspace snapshot and delegates opening to `uiWorkspace.openWorkspace`. The shared service reuses a blank session and prevents late navigation from replacing a newer selection. The selector locks concurrent choices, shows failures without exposing remote diagnostics, and discards local updates after unmount.

The two entries own distinct directory-flow child slots. An Add action appears only while its child is occupied. Both entries share one request controller: only one picker/adoption can be active, cancellation rejects old callbacks, and a late successful registration cannot start or finish navigation for a withdrawn request. An accepted Host registration is not rolled back. Unmount and Session navigation withdraw local adoption; failure offers a generic retry message.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

Session and workspace services own the list and archive operations; this package only owns local pins and navigation presentation. Creation is coalesced while pending; unmount cancels local navigation, and failures remain visible and retryable. Registry contributions dispose with the plugin. No runtime invariant companion is published because authoritative session membership is owned by the official services.

A menu synchronously locks pending service calls. Failure permits retry; closing invalidates queued clicks and late UI updates without cancelling accepted server operations.

</details>

<a id="model-experience"></a>
## Model Experience

### Browser presentation

#### What the model sees

`@deepseek-ai/dsh-qs-sessions`: this browser presentation delegates user actions to official services without constructing model requests.

#### Token effect

This package adds no prompt or tool-schema tokens of its own; official services handle user-submitted content.

#### KV Cache effect

None; neither entry assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- This selector opens already registered Workspaces. Native directory addition is available through qs-ui-directory-picker-native when that backend is selected. The browse branch uses qs-ui-directory-picker-browse for Host directory navigation and creation. Full platform acceptance remains pending.

- Archive recovery is not exposed here. Pins are browser-local; shared multi-user ordering is not provided.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

Validation status is recorded in the [review repair log](../../../qishu/PRD/1-AI工作台/复核测试/02-复核修复与全量验证.md).

</details>
