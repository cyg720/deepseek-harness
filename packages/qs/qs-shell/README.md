---
description: "Qishu workbench shell: root occupant, qs.* slot declarations, the --qs-* token contract, and the developer UI switch."
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-shell

English | [中文](README.zh.md)

## Summary

Developers get the Qishu workbench shell: the single occupant of the `root` slot, the declaration ledger for every top-level `qs.*` slot, the `--qs-*` design tokens and global class contract the other Qishu packages style against, and the developer switch between the workbench and the official interface. The shell registers at a negative priority so it shadows the official `AppFrame`; disabling the seven `qs-*` rows restores the official interface unchanged.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

Mount the plugin row named `@deepseek-ai/dsh-qs-shell`. A normal deployment also mounts the other six `qs-*` rows; this package is not usable on its own, because the login gate, session navigation, composer, transcript, approval, and question views arrive from those rows.

The conversation scrollport uses immediate programmatic scrolling so streamed content can remain pinned without intermediate animation events.

The row config decides the first screen:

```yaml
- id: qs-shell
  name: '@deepseek-ai/dsh-qs-shell'
  config:
    defaultUi: workbench      # workbench | official
    showOfficialUiEntry: false
```

`defaultUi: official` keeps the rows loaded but registers no workbench root, so the official interface wins without a restart. Disabling all seven rows is the separate teardown path that releases every workbench registration; changing the priority to a positive number only hands rendering back to the official frame and leaves the workbench registrations in place.

See the [first-priority plan](../../../qishu/dev-components/第一优先开发计划评审/00-评审总纲.md) for the milestone state and the [slot design](../../../qishu/dev-components/第一优先开发计划评审/06-槽位与状态设计.md) for the slot tree.

Desktop side panels support pointer and keyboard resizing. Panel widths, visibility, and the auxiliary tab survive refresh; signing out resets these layout preferences.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

The Host half ([src/index.ts](src/index.ts)) validates the row config through a `Schema` and publishes it to the browser as the `__QS_UI_CONFIG__` index-inject global. A `dsh.client` row's browser half is loaded by the client module system and never sees Loader row config, so the index-inject global is the only carrier.

The browser half ([src/client/index.ts](src/client/index.ts)) registers into `root` at priority `-1000`. A `single` slot rejects two entries at the same priority and renders only the winner among different priorities, so a negative priority is what makes the workbench the winner. That registration declares `qs.gate`, `qs.chrome`, `qs.nav`, `qs.stage`, `qs.inspector`, `qs.status`, and `qs.overlay`; a second registration for `qs.stage` declares `qs.stage.body`, `qs.stage.transcript`, and `qs.composer`, which makes the `Stage` component their rendering host. The other six packages wait for those declarations through `ctx.slots.inject`, so load order carries no requirement.

Cross-package sharing has exactly two channels. Appearance travels through [styles/tokens.css](src/client/styles/tokens.css) and [styles/contract.css](src/client/styles/contract.css), which the shell injects as global sheets scoped to `.qs-root`; behaviour travels through slots or Cordis services. The bundle-purity gate refuses runtime value imports between `@deepseek-ai/dsh-qs-*` packages, so no Qishu package imports another's components.

The `qsShell` service carries the developer switch controller. Its lifetime is independent of the workbench root registration: switching to the official interface releases the workbench registrations and keeps the controller, so returning re-registers them. The official-side return entry is a contribution to the official `sidebar.footer.action` slot, never a DOM injection into `AppFrame`.

`useQsAuth` is read as an optional seat rather than through `inject`: a missing required service leaves the fiber pending forever, and a permanently pending shell could never reach the "sign-in plugin is not loaded" fault page.

</details>

No runtime invariant companion is published because the official services own the authoritative session data and this package only presents it.

<a id="model-experience"></a>
## Model Experience

### Browser presentation

#### What the model sees

`@deepseek-ai/dsh-qs-shell`: the shell only registers slots, global styles, and a viewing-state controller, and contributes no prompt section, tool schema, or session event.

#### Token effect

This package adds no prompt or tool-schema tokens of its own; official services handle user-submitted content.

#### KV Cache effect

None; the shell never assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The right panel is a skeleton with an empty state. It deliberately shows no mock business data.
- The connection strip reports the connection state and offers a manual reconnect. It does not queue offline sends: a send while disconnected is refused by the composer, not buffered.
- The toast host has one API (`qsToast.show`). Dialogs do not go through it, because a native `<dialog>.showModal()` reaches the top layer on its own.
- The developer switch reaches the official interface but does not yet keep every workbench-only store across a round trip beyond the layout store and the composer's unowned draft.
- Accessible-name, focus-restoration, and 200% zoom checks have not been run.
- Visual reproduction is verified against tokens and layout metrics, not against a screenshot diff.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

The official-file registrations this package needs are logged in the [official source change list](../../../qishu/官方源码改动记录清单/00-登记规则与索引.md); the change list is authoritative for what was changed and what remains unverified.

</details>
