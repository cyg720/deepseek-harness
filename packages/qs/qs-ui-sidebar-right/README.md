---
description: "Qishu session-bound docking sidebar."
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-ui-sidebar-right

English | [中文](README.zh.md)

## Summary

Present session-bound tabs, splits and floats through an independent Qishu plugin while sharing the official right-sidebar store and TabDomain.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

The Web bundle mounts `@deepseek-ai/dsh-qs-ui-sidebar-right` beside `qs-shell`. It uses the Qishu design tokens and waits for its parent slot declaration. No plugin-specific configuration is required.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Registration and ownership</summary>

Reuse sidebarRightPresentation.store, seat bindings and tab hooks without a second controller. The shell supplies numbered expansion requests; the panel reports actual state without creating another request, so official navigation can reveal a collapsed panel. Bodies and titles register by official definition.id in qs.sidebar.right.tab and qs.sidebar.right.tab.title; menu and guide-chain seats retain separate extension roles. Missing bodies show a limitation and uninstalled guide entries are disabled. The official TabDomain owns resource lifetime and cross-session navigation; QS unload releases only its presentation. Shared docking components map Qishu colors locally, and floats remain inside the Qishu theme root. Fullscreen panels fill the shell content area below the responsive header. No invariant companion is published because this presentation owns no independent durable domain state.

</details>

<a id="model-experience"></a>
## Model Experience

### Browser presentation

#### What the model sees

`@deepseek-ai/dsh-qs-ui-sidebar-right` changes browser presentation only.

#### Token effect

No additional prompt or tool-schema tokens.

#### KV Cache effect

None; this plugin does not construct provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Persistence observes the shared official store while either interface is in use. The mounted QS seat owns saving and immediate error notices; a root listener saves when that seat is absent, so one commit is not written twice. Persistent storage failures become visible when returning to QS. Deleted-session cleanup and complete narrow-screen keyboard acceptance remain unfinished. Files and previews belong to separate plugins. Shared docking-menu portal theming needs targeted acceptance. The static login gate is not authentication.

QS stores version-1 layout metadata per Session in browser localStorage. First restoration uses the official store action, preserves existing live surfaces, resolves current titles and requires a registered QS body. File addresses must parse through the official parser and belong to the current Session; other resource protocols, unavailable tabs and duplicate pages in one pane are removed with a visible notice. Floats fit the current viewport, and split fractions retain the official 20% minimum. Invalid records and storage refusal leave usable panels with a localized notice. Clearing the saved record keeps current tabs open. No titles, content, navigation parameters, runtime identities or undo history are saved. An authenticated-to-signed-out transition clears this plugin’s records across Sessions, and signed-out readers and writers cannot restore or recreate them. Cold login and plugin unloading preserve records. Browser deletion refusal does not block sign-out and may leave disk records; the static gate does not provide data isolation.

Mounted QS session seats fit floats on entry and window resize through the shared official store. Resize events coalesce into one animation frame; unmount cancels pending work. Geometry changes preserve focus and stacking and follow the existing layout persistence path.

The prototype’s Move earlier button reorders the active docked tab through the official placeTab action. It is disabled for the first tab, an empty pane and a floating pane; tab identity and resource ownership remain unchanged.

### Dev Note

Plugin correspondence and validation are documented in packages/qs/FRAMEWORK.md.
