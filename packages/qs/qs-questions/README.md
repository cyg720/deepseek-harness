---
description: "Qishu workbench question card: question forms, plan review, and the answer protocol."
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-questions

English | [中文](README.zh.md)

## Summary

Answer single-choice, multiple-choice, and free-text questions, or review a read-only Markdown plan. Incomplete batches focus the first unanswered question; failed submissions preserve answers.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

Mount `@deepseek-ai/dsh-qs-questions` with the other Qishu plugin rows in the [Web bundle](../../bundle/web-app/cordis.patch.yml). The package has no deployment configuration fields.

Single-choice options and custom text are mutually exclusive: the latest choice replaces the previous answer. Multiple-choice answers retain both selected options and custom text.

Drafts survive interface switches while the request remains pending. Settlement or withdrawal through the official request clears only that request’s drafts, including answers made outside the workbench.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

The official question domain owns pending requests and response encoding. Drafts are keyed by session, request, and question in plugin memory. This package has no independent durable authority requiring a runtime invariant companion.

Each request holds a synchronous submission lock; failed answers release it for retry. Plan buttons submit their original option labels, including empty labels displayed through localized fallback text.

</details>

No runtime invariant companion is published because the official services own the authoritative session data and this package only presents it.

<a id="model-experience"></a>
## Model Experience

### Browser presentation

#### What the model sees

`@deepseek-ai/dsh-qs-questions`: this browser presentation delegates user actions to official services without constructing model requests.

#### Token effect

This package adds no prompt or tool-schema tokens of its own; official services handle user-submitted content.

#### KV Cache effect

None; neither entry assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Question drafts survive session navigation only within the loaded plugin; page reload or plugin replacement clears them.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

Validation status is recorded in the [review repair log](../../../qishu/PRD/1-AI工作台/复核测试/02-复核修复与全量验证.md).

</details>
