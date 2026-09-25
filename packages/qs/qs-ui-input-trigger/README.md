---
description: "Qishu command candidate menu."
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-ui-input-trigger

English | [中文](README.zh.md)

## Summary

Present command candidates through the official per-session input-trigger controller.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

The Web bundle mounts this plugin beside qs-composer. It contributes only to qs.composer.overlay and leaves the official menu available in the official interface.

<a id="understand-the-implementation"></a>
## Understand the implementation

The input host owns the consumer lease. This plugin binds caret and keyboard adapters and subscribes to official menu state; disposal removes its adapter and dismisses its menu. It creates no second controller or source registry. No invariant companion is published because it owns no independently mutable domain state.

<a id="model-experience"></a>
## Model Experience

### @deepseek-ai/dsh-qs-ui-input-trigger

#### What the model sees

`@deepseek-ai/dsh-qs-ui-input-trigger`: No model-visible behavior; execution stays in official command and input services.

#### Token effect

No additional prompt or schema tokens.

#### KV Cache effect

None; this plugin does not assemble model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Command popup selection and confirmation belong to the separate qs-ui-commands presentation. Directory failure and empty-result recovery still require integration validation; this package alone does not complete D7.

### Dev Note

Plugin correspondence and validation are documented in [FRAMEWORK.md](../FRAMEWORK.md).
