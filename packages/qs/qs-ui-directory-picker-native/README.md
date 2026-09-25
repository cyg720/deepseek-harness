---
description: "Qishu native directory picker over the official Host capability."
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-ui-directory-picker-native

English | [中文](README.zh.md)

## Summary

Choose a Host directory from the Qishu welcome or sidebar entry using the OS dialog.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

This independent counterpart of ui-directory-picker-native fills both QS directory-flow slots. The Web auto resolver adds it only for the native backend. A fixed composition must pair it with the official native Host provider; the package does not provide an OS service itself.

<a id="understand-the-implementation"></a>
## Understand the implementation

Each request identity starts one official uiWorkspace.pickDirectory call. Effect replay reattaches to the same promise. Closing, replacing the request or unmounting discards obsolete success and failure callbacks. Host-side chooser cancellation is not exposed by this Client method; closing the QS entry withdraws adoption while the OS chooser may remain open until answered. The QS workspace owner registers the returned directory and controls navigation. Both slot registrations dispose together. No invariant companion is published because the component owns no independent durable domain state.

<a id="model-experience"></a>
## Model Experience

### Browser presentation

#### What the model sees

The view invokes `uiWorkspace.pickDirectory` and creates no model messages. A selected directory becomes a workspace only through the official workspace owner.

#### Token effect

No additional prompts or tool schemas.

#### KV Cache effect

The view does not construct provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- This package needs a local Host display and the native capability. Remote browsing belongs to a separate plugin. Component tests substitute the OS chooser promise; Web tests substitute only the Host capability result. They do not prove visual behavior of a platform OS dialog.

### Dev Note

Directory access validation and session creation remain owned by official Host and Client services.
