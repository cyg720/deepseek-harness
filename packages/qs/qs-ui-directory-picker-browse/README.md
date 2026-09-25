---
description: "Qishu directory browser over the official Host capability."
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-ui-directory-picker-browse

English | [中文](README.zh.md)

## Summary

Browse Host directories from either Qishu workspace entry without creating another Host provider.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

This independent counterpart of ui-directory-picker-browse fills both QS directory-flow slots. The Web auto resolver adds it for the browse backend. Fixed compositions must include the official browse Host provider and this Client surface. Paths refer to the Host, which may differ from the browser machine.

<a id="understand-the-implementation"></a>
## Understand the implementation

The dialog supports full-path navigation, home and ancestor navigation, hidden directories, creation and selection. It uses only complete paths returned by the Host. Superseded scans receive an abort signal and cannot publish late results. Each request owns a fresh controller and drafts. Closing prevents pending creation from navigating; it does not undo a directory already created on the Host. Read failures disable selection of the stale listing. Localized errors omit raw diagnostics. Both slot contributions and dictionaries dispose with the plugin. No invariant companion is published because this view owns no independently observable durable domain state.

<a id="model-experience"></a>
## Model Experience

### Browser presentation

#### What the model sees

The view calls `uiWorkspace.listDirectory` and `uiWorkspace.createDirectory` without adding model messages. The QS workspace owner registers a confirmed path and opens its session through the official services.

#### Token effect

No additional prompts or tool schemas.

#### KV Cache effect

The view does not construct provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Host listing bounds can omit the sorted tail of large directories; the dialog announces truncation and permits full-path navigation. Creating a directory is an immediate filesystem operation, not a reversible selection preview. Browse and native surfaces must not occupy the same slots simultaneously.

### Dev Note

Component checks cover request isolation. Real Host composition and the complete platform matrix require separate acceptance evidence.
