---
description: "Qishu left navigation shell."
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-ui-sidebar

English | [中文](README.zh.md)

## Summary

Display the Qishu left navigation shell as an independently mounted plugin while keeping official services and the official interface available.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

The Web bundle mounts `@deepseek-ai/dsh-qs-ui-sidebar` beside `qs-shell`. It uses the Qishu design tokens and waits for its parent slot declaration. No plugin-specific configuration is required.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Registration and ownership</summary>

The layout passes live owner props through slots. This plugin owns its view, dictionary and disposable registration. It never imports another feature plugin component or creates a second Session service. No runtime invariant companion is published because this presentation has no independent durable observations to reconcile.

The sidebar also owns qs.sidebar.settings, the independently mounted settings-shell entry beside the profile. It does not own configuration state.

</details>

<a id="model-experience"></a>
## Model Experience

### Browser presentation

#### What the model sees

`@deepseek-ai/dsh-qs-ui-sidebar` changes browser presentation only.

#### Token effect

No additional prompt or tool-schema tokens.

#### KV Cache effect

None; this plugin does not construct provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Navigation placeholders do not implement application catalogs or third-priority diagnostic panels. The static login gate is not authentication.

The Apps entry explains that third-party integrations are deferred for this release. It has no authorization actions, credential fields or external connection. Other unconnected directories retain their own empty state.

### Dev Note

Plugin correspondence and validation are documented in packages/qs/FRAMEWORK.md.
