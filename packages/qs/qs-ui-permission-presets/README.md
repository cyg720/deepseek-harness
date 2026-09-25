---
description: "Qishu permission preset presentation over official commands and settings."
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-ui-permission-presets

English | [中文](README.zh.md)

## Summary

Present permission presets through the existing Host permission command.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

This independent counterpart of ui-permission-presets contributes the bare /permission picker. The QS Web profile mounts it beside the official plugin. Its explicit higher-priority decorator is registered only while the QS settings slot exists; switching to the official root releases it and restores the official presentation.

<a id="understand-the-implementation"></a>
## Understand the implementation

Options and active state come from the current session permissions projection. Selecting a target delegates to the Host /permission command; its pushed projection confirms the resulting state. Custom is display-only. Full access includes an explicit acknowledgement requirement consumed by the QS command popup. Disposing the plugin releases its dictionary and command contribution. No invariant companion is published because the official command registry and permission domain own the relevant identities and authorization.

The default permission row derives its options from the official dynamic schema and writes only `permission.defaultPreset`. It preserves the selection revision and connection epoch, requires explicit acknowledgement for full access, rejects read-only settings, and displays conflict or unconfirmed-write feedback. Reset invalidates old confirmations and write results; a late successful response cannot roll back a newer shared mirror. Existing session permissions are unchanged.

<a id="model-experience"></a>
## Model Experience

### Browser presentation

#### What the model sees

The package adds no model message or tool definition. The Host `/permission` command controls subsequent operation permissions.

#### Token effect

No additional prompt tokens.

#### KV Cache effect

The presenter does not construct model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Selecting a default affects subsequently created sessions only. The row does not bulk-update existing sessions; use the current-session permission command for them.

### Dev Note

Keep the current-session command separate from the new-session default: neither implies the other was changed.
