---
description: "Qishu workspace directory tree sharing the official file state."
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-ui-sidebar-files

English | [中文](README.zh.md)

## Summary

Qishu workspace directory tree sharing the official file state.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

The Web profile mounts this plugin alongside the official file-tree data owner and the Qishu right sidebar. It has no plugin-specific configuration.

<a id="understand-the-implementation"></a>
## Understand the implementation

Bodies and titles register under the official files definition identity in the Qishu keyed slots. sidebarFilesPresentation owns the store handle and request generations; this plugin only reads its session/tab state and calls its operations. Files open through tab resource navigation. Directory permissions and entry caps remain Host-owned. Unknown Remote failures use localized generic copy rather than raw diagnostics. No invariant companion is published because this view owns no independent domain state.

<a id="model-experience"></a>
## Model Experience

### Browser presentation

#### What the model sees

`@deepseek-ai/dsh-qs-ui-sidebar-files` only changes browser presentation; no new model-visible input.

#### Token effect

No additional prompt or tool-schema tokens.

#### KV Cache effect

None; directory reads do not construct provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- File preview rendering belongs to the separate document-preview plugin and is not implemented here. No rename, delete, filesystem watching or directory search is provided. The broader workspace selection flow and file preview remain pending.

### Dev Note

The official file-tree owner retains state across presentation switches.
