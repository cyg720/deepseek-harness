---
description: "Qishu delivery cards sharing official durable file facts and native actions."
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-ui-deliverables

English | [中文](README.zh.md)

## Summary

Qishu delivery cards sharing official durable file facts and native actions.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

The Web profile mounts this plugin alongside official ui-deliverables, the Qishu transcript and tool presentation. It has no plugin-specific configuration.

<a id="understand-the-implementation"></a>
## Understand the implementation

Independent turn-tail and present-tool contributions use the official deliverablesPresentation selector and shared native-open controller. Workspace previews use official resource navigation; only explicit Open or Reveal gestures request native actions on the serving Host. The viewed Session and original delivery event/index authorize each action. Descriptions render as text, pending actions disable repeat gestures, and Host metadata failures remain retryable. No invariant companion is published because the plugin owns no independent domain state.

<a id="model-experience"></a>
## Model Experience

### Browser presentation

#### What the model sees

`@deepseek-ai/dsh-qs-ui-deliverables` only changes browser presentation; no new model-visible input.

#### Token effect

No additional prompt or tool-schema tokens.

#### KV Cache effect

None; delivery rendering does not construct provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Attachments and trajectory navigation belong to separate plugins. Inline-code file mentions in the final answer use the official provider and open the same workspace preview. Native actions require a desktop on the serving Host, not the browser device. Full second-priority acceptance remains incomplete.

### Dev Note

The official file-tree owner retains state across presentation switches.
