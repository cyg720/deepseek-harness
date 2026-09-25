---
description: "Qishu workbench approval card: pending approval presentation, callId-derived detail, and the qs.stage.interaction contribution."
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-approval

English | [中文](README.zh.md)

## Summary

Review a pending tool approval and allow it once or reject it. Failed answers leave the request available for retry; details remain keyboard-scrollable.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

Mount `@deepseek-ai/dsh-qs-approval` with the other Qishu plugin rows in the [Web bundle](../../bundle/web-app/cordis.patch.yml). The package has no deployment configuration fields.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

The official approval domain owns pending requests and answers. A failed answer retries the same approval decision. This package contributes a request-keyed interaction card and derives displayed details from the recorded tool call. It has no independent authority requiring a runtime invariant companion.

Each request holds a synchronous submission lock until its answer fails or the card is replaced; duplicate events cannot send another answer.

</details>

No runtime invariant companion is published because the official services own the authoritative session data and this package only presents it.

<a id="model-experience"></a>
## Model Experience

### Browser presentation

#### What the model sees

`@deepseek-ai/dsh-qs-approval`: this browser presentation delegates user actions to official services without constructing model requests.

#### Token effect

This package adds no prompt or tool-schema tokens of its own; official services handle user-submitted content.

#### KV Cache effect

None; neither entry assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Only allow-once and reject are exposed. Persistent permission-rule editing is outside this card.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

Validation status is recorded in the [review repair log](../../../qishu/PRD/1-AI工作台/复核测试/02-复核修复与全量验证.md).

</details>
