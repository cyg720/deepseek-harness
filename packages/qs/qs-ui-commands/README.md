---
description: "Qishu commands presentation."
kind: "package-reference"
---

# qs-ui-commands

English | [中文](README.zh.md)

## Summary

Present command options and risk acknowledgements through the official per-session command controller.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

The Web bundle mounts this plugin beside qs-composer. It contributes to qs.composer.overlay and reuses the unique official commandUi service; the official interface retains its own presentation.

<a id="understand-the-implementation"></a>
## Understand the implementation

The official controller owns option loading, filtering, selection, risk acknowledgement and token consumption. The view freezes its input host while open, restores session-specific focus, and releases its freeze and focus subscriptions on unmount. Dismissal revokes late UI writes and draft consumption; it does not undo a business operation already submitted. No invariant companion is published because no independently mutable domain state is owned here.

Risk confirmation uses a native modal dialog inside the Qishu theme root. The browser contains focus, Escape returns to the options without executing, and the official controller still requires explicit acknowledgement.

<a id="model-experience"></a>
## Model Experience

### @deepseek-ai/dsh-qs-ui-commands

#### What the model sees

`@deepseek-ai/dsh-qs-ui-commands`: No new model-visible behavior; selected commands execute through official command services.

#### Token effect

No additional prompt or schema tokens.

#### KV Cache effect

None; this plugin does not assemble model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Command catalog failures belong to the command candidate presentation; this view handles option loading and execution failures. Full second-priority acceptance requires the other planned plugins and integration scenarios.

### Dev Note

Plugin correspondence and validation are documented in [FRAMEWORK.md](../FRAMEWORK.md).
