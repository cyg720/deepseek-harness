---
description: "Qishu workbench composer: draft, send, stop, queue handling, and the no-session creation hand-off."
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-composer

English | [中文](README.zh.md)

## Summary

Compose and send messages in the selected session, or create a session on the first send. Running sessions accept queued messages; queue rows can be edited, removed, or steered. Failed creation keeps the draft and its reserved session identity.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

Mount `@deepseek-ai/dsh-qs-composer` with the other Qishu plugin rows in the [Web bundle](../../bundle/web-app/cordis.patch.yml). The package has no deployment configuration fields.

If a first-message handoff becomes blocked, its draft remains editable. Recovery requires another explicit send; reconnecting does not automatically submit the retained draft.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

The client delegates sending to the official input machine. Cancellation and unmount invalidate pending creation before navigation; failed requests never prove creation succeeded. Session-owned notices and blocks remain authoritative. No runtime invariant companion is published because this adapter has no independent durable projection to compare.

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

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

Validation status is recorded in the [review repair log](../../../qishu/PRD/1-AI工作台/复核测试/02-复核修复与全量验证.md).

</details>
