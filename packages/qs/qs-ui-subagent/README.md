---
description: "Subagent catalog and read-only input over official sessions."
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-ui-subagent

English | [中文](README.zh.md)

## Summary

Browse child sessions and explain read-only input in the Qishu workbench.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

This independent ui-subagent counterpart requires official Session services and Qishu composer slots. The shipped Web profile registers it independently; slot declarations keep it dormant while the official interface is selected.

<a id="understand-the-implementation"></a>
## Understand the implementation

Child navigation uses full official catalog addresses. Expanded branches acquire catalog observations and release them on collapse or unmount. One-shot children are read-only; a continuable child with an explicitly unavailable parent is read-only only when stopped. Unknown availability does not imply offline. Running continuable children retain the normal Stop action. No invariant companion is published because the view owns no independent domain state.

<a id="model-experience"></a>
## Model Experience

### Browser presentation

#### What the model sees

The view creates no model messages or history definitions. Navigation reads existing `subagent/descriptor` histories.

#### Token effect

No additional prompt or tool-schema tokens from the presentation.

#### KV Cache effect

The view does not construct provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Catalog diagnostics cannot be opened. Running/inactive is live activity, not a success or failure outcome. Sibling navigation, directional keys, Home/End and 760-pixel containment have browser evidence. The catalog uses native nested lists and buttons, not ARIA tree roles. A real Host scenario verifies parent-unavailable input restrictions, child-specific cancellation and FIFO continuation. Parent unavailability in that scenario is injected at the catalog response, while execution and replay consumption stay real. Optional catalog metrics remain under review.

### Dev Note

Catalog observations and request ordering belong to the official Session owner; this plugin keeps only presentation state.
