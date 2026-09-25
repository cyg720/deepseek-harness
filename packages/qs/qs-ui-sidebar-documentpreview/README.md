---
description: "Qishu document preview sharing official content reads and tab state."
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-ui-sidebar-documentpreview

English | [中文](README.zh.md)

## Summary

Qishu document preview sharing official content reads and tab state.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

The Web profile mounts this plugin alongside the official document-preview owner and the Qishu right sidebar. It has no plugin-specific configuration.

<a id="understand-the-implementation"></a>
## Understand the implementation

The keyed Qishu document host shares documentPreviewPresentation with the official interface. Official metadata chooses the read mode; the Host retains file permissions and size limits. The host owns reload, version notices, paging, wrap and source-line navigation. The text subplugin renders escaped source lines; independent Markdown and code subplugins use the public MarkdownText and CodeBlock primitives. Code scroll position and line navigation use its inner scrollport. The image subplugin displays complete bytes at intrinsic size through an img Blob URL; SVG never enters the application DOM. Replacing or unloading an image releases its URL. HTML uses the official prepareHtml operation to collect only finite static scripts and stylesheets, then runs in an iframe with exactly sandbox="allow-scripts". Cancellation retires stale preparation and releases the frame URL; no Host callback enters the iframe. PDF uses the official documentPdfPresentation store, worker and bounded canvas renderer; visible pages are drawn lazily and body disposal cancels rendering and releases the worker. No invariant companion is published because this view owns no independent domain state.

<a id="model-experience"></a>
## Model Experience

### Browser presentation

#### What the model sees

`@deepseek-ai/dsh-qs-ui-sidebar-documentpreview` only changes browser presentation; no new model-visible input.

#### Token effect

No additional prompt or tool-schema tokens.

#### KV Cache effect

None; directory reads do not construct provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Plain text, Markdown, code, image, HTML and PDF bodies are implemented. PDF has no independent zoom control, password entry or byte-view scroll restoration, matching the current official reader. File-tree opening and viewer switching have focused browser coverage; package-local per-file coverage passes, while full second-priority acceptance remains incomplete. The workspace directory picker is a separate plugin.

### Dev Note

The official preview owner retains content, request generations and reading state across presentation switches.
