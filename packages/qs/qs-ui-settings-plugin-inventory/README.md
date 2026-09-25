---
description: "Qishu read-only Host plugin inventory."
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-ui-settings-plugin-inventory

English | [中文](README.zh.md)

## Summary

Inspect global plugins and per-preset composition through the official read-only inventory RPC.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

This independent counterpart of ui-settings-plugin-inventory contributes the all tab to qs.settings.plugins.tab. Mount it with qs-ui-settings-plugins in the Web bundle; the official Host inventory service remains unique. No additional configuration is required.

<a id="understand-the-implementation"></a>
## Understand the implementation

The page loads lazily and ignores replies after its request owner is disposed. Failed reads expose a localized retry instead of raw RPC errors. Search covers module specifiers and entry IDs across global and preset groups; failed global entries sort first. Preset conditions and broken metadata are text, never scripts. No invariant companion is published because this page has no independently maintained inventory.

<a id="model-experience"></a>
## Model Experience

### Browser presentation

#### What the model sees

`@deepseek-ai/dsh-qs-ui-settings-plugin-inventory` adds no model messages or tool definitions.

#### Token effect

No additional prompt tokens.

#### KV Cache effect

The row does not construct model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The snapshot is point-in-time. Closing and reopening settings refreshes it. This page does not enable, disable or uninstall plugins; null runtime state means unobserved, not confirmed stopped.

### Dev Note

Keep global enablement, per-preset conditional enablement and observed Fiber phase separate. Preset names use the official display resolver and preserve user-authored names.
