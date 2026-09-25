---
description: "Qishu model and reasoning-effort selection over the shared official directory."
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-ui-model-selection

English | [中文](README.zh.md)

## Summary

Select the current session model and its supported reasoning effort from the composer or /model menu. Both entries use the official session directory and retain provider-owned identifiers.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

The QS Web composition mounts this independent counterpart of ui-model-selection. The composer uses the prototype dropdown layout. Addressed subagents do not expose Agent-bound selection. There are no deployment configuration fields.

<a id="understand-the-implementation"></a>
## Understand the implementation

The official modelDirectories service remains unique. Slot contributions and a priority-one command decorator follow the QS composer slot lifetime; removing them restores official presentation. Model ids are looked up as complete option keys, and selecting the same model retains its explicit effort. Switching models uses that model's declared default. No invariant companion is published because this presenter owns no independent authoritative model state.

<a id="model-experience"></a>
## Model Experience

### Model selection

#### What the model sees

The official `session.selectModel` operation controls subsequent model requests; this presenter adds no model-visible message or tool.

#### Token effect

No additional prompt tokens.

#### KV Cache effect

Changing the selected provider or model may change the subsequent request route; cache behavior belongs to the provider.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- No-session selection and provider credential editing are outside this presenter; the latter belongs to the separate settings-models plugin. Reconnection and late selection replies still require complete acceptance before W10 is complete.

### Dev Note

Model configuration and credentials belong to the independent settings-models presenter; do not create another modelDirectories resolver here.
