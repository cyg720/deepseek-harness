---
description: "Qishu workbench sign-in view: static authentication state, the qsAuth service, and the qs.gate contribution."
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-login

English | [中文](README.zh.md)

## Summary

Users can enter the local demonstration workbench through a static sign-in form. This form does not authenticate API access; no backend sign-in endpoint is connected.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

Mount this row with the other Qishu plugins in the Web bundle. The local demo accepts `admin` and `Demo@2026`; these values are not production credentials.

Keep me signed in restores the static demo session after refresh. It stores only the demo username and an opt-in marker, never the password; signing out clears both. This is a presentation gate and grants no Host authentication or authorization.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

One plugin-owned auth store supplies both the form and the root gate. The local gateway validates the demo credentials without persisting passwords. No runtime invariant companion is published because the gate has only one source of auth state.

</details>

<a id="model-experience"></a>
## Model Experience

### Browser presentation

#### What the model sees

`@deepseek-ai/dsh-qs-login`: the static sign-in gate contributes no model-visible input.

#### Token effect

This package adds no prompt or tool-schema tokens of its own; official services handle user-submitted content.

#### KV Cache effect

None; neither entry assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Real authentication, authorization, and account recovery are not connected.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

The [first-priority plan](../../../qishu/dev-components/第一优先开发计划评审/00-评审总纲.md) defines future functionality; its milestones are not completed by these placeholders.

</details>
