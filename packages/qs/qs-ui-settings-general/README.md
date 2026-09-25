---
description: "Qishu settings navigation and general preference composition."
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-ui-settings-general

English | [中文](README.zh.md)

## Summary

Open settings in the Qishu sidebar. The dialog composes independently registered sections and general preference rows.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

The Web bundle loads this independent counterpart of ui-settings-general beside the official settingsScope service. Only registered QS sections appear. Configuration editing belongs to the feature that registers each section.

<a id="understand-the-implementation"></a>
## Understand the implementation

The sidebar owns the trigger slot. This plugin owns the dialog, section and action slots, ordered onboarding and the General section. Host configuration and revisions come from the official describe mirror. The local-document action is present only on loopback connections with a file-backed provider; it never accepts a client path. Failed opens show localized feedback. Native dialogs own modal focus and Escape. No invariant companion is published because configuration and connection authorities remain in official services.

<a id="model-experience"></a>
## Model Experience

### Browser presentation

#### What the model sees

`@deepseek-ai/dsh-qs-ui-settings-general` adds no model messages or tool definitions.

#### Token effect

No additional prompt tokens.

#### KV Cache effect

The shell does not construct model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The shell does not implement model, plugin, inventory, permission, model-selection or preset forms. Their independent QS plugins must contribute those sections and actions. Theme, language and conversation preferences likewise remain feature-owned. Shell availability is not complete W10 acceptance.

### Dev Note

Settings values and document availability remain official service facts; this plugin owns presentation and local dialog state only.
