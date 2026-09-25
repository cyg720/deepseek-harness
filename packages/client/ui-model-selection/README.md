---
description: "Model selection for the Web GUI: the /model popup and the composer model seat over one per-session provider-grouped directory; for users and maintainers of model routing."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-model-selection

English | [中文](README.zh.md)

## Summary

The Web GUI lets users switch the model and reasoning effort for an existing session through either the `/model` popup or the composer's model control. Both surfaces present the same provider-grouped choices, and the selected model determines the available effort names and default. A complete selection applies to the next request; a running step keeps the model and effort it started with. If no adapter can serve the session's route, the composer remains disabled until routing becomes available.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin alongside `ui-conversation` and the commands package; the composer then shows the model seat next to the pending indicator, and `/model` opens the same directory as a popup. Both surfaces show the host-reported current selection when the exact provider/model pair remains in the advertised groups; a missing catalog row leaves the routable selection intact while the trigger prompts `Select model`.

### Model and effort

Models stay grouped by provider. The composer menu shows model and effort names only. The `/model` popup shows provider names and catalog descriptions; it localizes the two built-in DeepSeek descriptions and leaves external provider descriptions verbatim. The popup applies the selected model's default effort; the composer can then choose any advertised effort. An adapter without reasoning metadata leaves the Effort row absent; there is no arbitrary effort input.

### Unroutable sessions

When the Host reports that no adapter serves the session's route, this plugin raises a composer block and the input goes inert with its own copy; recovering clears it without a reload. A `null` before the first load or after one failed never blocks, and catalog membership never blocks either — a route serving a model it does not advertise is missing from the groups yet usable.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The `/model` command and composer model seat share one per-session `ModelDirectory` owned by `ModelDirectoryResolver`. A Host-wide catalog loads through `session.modelCatalog`; selections use `session.selectModel`, and the durable Session projection determines the displayed current model. Catalog and selection requests have independent generation counters. Connection resets invalidate pending selections and refresh the shared catalog while retaining the last complete view until fresh data arrives. Transport rejections and unsuccessful RPC responses release the selection lock and expose an error; late responses after reset, disposal, or a newer selection cannot change operation status. Directories are disposed with their session scopes, and addressed subagents expose neither entry. Adapter, settings, and credential-reference updates refresh the shared catalog.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the model surface is not enough. They move from the browser surfaces to the command popup shell and the selection contract.

- [ui-commands](../ui-commands/README.md) — the popupSelect shell the `/model` contribution registers into.
- [ui-conversation](../ui-conversation/README.md) — declares the composer's `conversation.input.model` seat and the composer block.
- [dsh-agent-default-model](../../core/agent-default-model/README.md) — the default-model service for sessions that never choose.
- [Client package map](../README.md) — adjacent browser UI packages.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the `session.selectModel` selection both entries submit: the Host snapshots the complete `ModelSelection` at the next prompt-assembly boundary and owns the model-visible effect, while a running step keeps its assembled selection.

#### KV Cache effect

Switching the route can reduce or invalidate provider-side cache reuse for subsequent requests; the prompt prefix itself is untouched.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the current model surface. They are current package constraints, not a general model-router comparison or a task backlog.

- **No create-time or addressed-subagent selection** — both entries require an existing ordinary session's Agent; there is no draft-phase model choice to fold into session creation, and subagent continuation deliberately exposes no independent model-selection contract.
- **Directory names are presentation-only** — selection and persistence use provider/model/effort ids; a provider whose catalog or exact-model metadata lookup fails lists as an unselectable failure row until reload.
- **No arbitrary effort input** — the composer offers only the exact model's adapter-advertised levels; an adapter without reasoning metadata leaves the Effort row absent.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The plugin registers a single command contribution, and the HMR-safety spec proves that the registration is disposed correctly. The plugin emits no Cordis events and owns no cross-plugin mutable state.
