---
description: "Qishu brand mark and name."
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-ui-brand

English | [中文](README.zh.md)

## Summary

Display the Qishu brand mark and name as an independently mounted plugin while keeping official services and the official interface available.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

The Web bundle mounts `@deepseek-ai/dsh-qs-ui-brand` beside `qs-shell`. It uses the Qishu design tokens and waits for its parent slot declaration. No plugin-specific configuration is required.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Registration and ownership</summary>

The layout passes live owner props through slots. This plugin owns its view, dictionary and disposable registration. It never imports another feature plugin component or creates a second Session service. No runtime invariant companion is published because this presentation has no independent durable observations to reconcile.

</details>

<a id="model-experience"></a>
## Model Experience

### Browser presentation

#### What the model sees

`@deepseek-ai/dsh-qs-ui-brand` changes browser presentation only.

#### Token effect

No additional prompt or tool-schema tokens.

#### KV Cache effect

None; this plugin does not construct provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Brand assets apply to the workbench only; official branding remains unchanged.

### Dev Note

Plugin correspondence and validation are documented in packages/qs/FRAMEWORK.md.
