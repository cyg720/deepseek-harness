---
description: "Qishu message-feedback presentation."
kind: "package-reference"
---

# qs-ui-message-feedback

English | [中文](README.zh.md)

## Summary

Provide persistent assistant-message ratings and session feedback through the official shared feedback owner.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

The Web bundle mounts message actions in qs.chat.assistant-actions and the session form in qs.composer.overlay. Only a closing assistant message with a durable messageId receives rating controls. Clicking an unrecorded rating opens the form; clicking the recorded rating retracts it. The bare /feedback command opens session feedback through the official decoration; an argument-bearing command remains Host-owned.

<a id="understand-the-implementation"></a>
## Understand the implementation

messageFeedbackPresentation supplies the same per-session actions and dialog used by the official interface. This plugin owns no controller, command registration or durable state. Category, text and feedback target stay in that shared form. Failures preserve the draft, version conflicts expose the authoritative result, and closing an in-flight submission does not cancel an accepted write. The input freeze lasts while the mounted dialog is open. Session switching releases the view's freeze and preserves the official session draft. No invariant companion is published because no independently mutable domain state is owned here.

<a id="model-experience"></a>
## Model Experience

### @deepseek-ai/dsh-qs-ui-message-feedback

#### What the model sees

`@deepseek-ai/dsh-qs-ui-message-feedback`: No new model-visible input. Feedback writes use the official durable feedback events and do not start a model turn.

#### Token effect

No additional prompt or schema tokens.

#### KV Cache effect

None; this plugin does not assemble model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Feedback acknowledgements are separate from task-completion notifications. This plugin neither observes job completion nor sends operating-system notifications. Task notifications remain a layout-owned consumer with independent deduplication and reconnection rules.

### Dev Note

Plugin correspondence and validation are documented in [FRAMEWORK.md](../FRAMEWORK.md).
