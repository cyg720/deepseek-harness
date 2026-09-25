---
description: "Existing attachment previews with session-authorized reads."
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-ui-attachment

English | [中文](README.zh.md)

## Summary

Existing image attachments with retry and original preview.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

The Web profile mounts this plugin with the Qishu transcript and tool presenters. There is no package-specific configuration.

<a id="understand-the-implementation"></a>
## Understand the implementation

Message, tool and trajectory slots register independently. The official session-authorized loader owns URLs and caching; this plugin owns only displayed loading state and original preview. Disposing a view ignores late responses. No invariant companion is published because there is no independent domain state. The original preview covers the viewport through a body portal. Its close button receives focus; Escape, backdrop press and the close control dismiss it and restore the opening element.

<a id="model-experience"></a>
## Model Experience

### Browser presentation

#### What the model sees

`@deepseek-ai/dsh-qs-ui-attachment` only changes existing attachment presentation; no new model-visible input.

#### Token effect

No additional prompt or tool-schema tokens.

#### KV Cache effect

None; image rendering does not construct provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- New uploads are excluded. Trajectory activation requires its owning presenter. Browser and full second-priority acceptance remain pending.

### Dev Note

The official conversation owner retains image URLs across presentation switches.
