---
description: "Qishu plugin settings navigation with feature-owned tabs."
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-ui-settings-plugins

English | [中文](README.zh.md)

## Summary

Navigate independently contributed plugin settings pages without losing mounted page drafts.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

This package corresponds to ui-settings-plugins. Its current implementation contributes the Plugins section and qs.settings.plugins.tab. The independent inventory tab is connected; Shell and AgentLoop numeric cards are connected; the navigation alone is not a complete settings implementation.

<a id="understand-the-implementation"></a>
## Understand the implementation

The tab directory observes slot and locale revisions. Pages mount on first selection and remain mounted while hidden; removing their contribution releases them. Arrow keys, Home and End move focus and select tabs. No invariant companion is published because the slot ledger owns contribution identity.

The configurable tab pairs dynamically registered card keys with namespaces served by the official shared settings mirror. It distinguishes initial loading, unavailable connections, failed initial reads with retry, read-only views and an empty card directory. WebSearch is connected; real Host save and credential-only retry have browser coverage.

The card writer submits one atomic batch with the revision captured when editing began. It distinguishes acknowledged writes from conflicts and refusals, rejects duplicate in-flight saves, and ignores settlement after disposal. A success older than the mirror does not replace newer data. Shell and AgentLoop forms use this writer; The subagent form also uses this writer; WebSearch is connected; real Host save and credential-only retry have browser coverage.

The WebSearch credential accessor reads only configured/writable metadata. It requires an explicit successful set result, isolates stale references and disposes late settlements without publishing secret literals. The combined saver reports configuration and credential results separately, stops before a credential write on configuration failure or reference changes, and allows credential-only retries. The editor clears only acknowledged fields, retains failed drafts and removes credential literals on card unmount, discard, reconnect and disposal. These components have isolated tests; the visible WebSearch form and credential invalidation subscriptions are connected. A real Host browser scenario verifies configuration success with an interrupted credential request, credential-only retry, persistence after reload and an empty password field.

The subagent configuration directory reader invalidates older requests on refresh, connection reset and disposal. It retains stored routes absent from the live catalog so they can be removed. Its editor stages the switch and allowed routes as one revision-fenced mutation, preserves failed drafts and drops old-connection drafts on reset. The subagent card and its adapter, settings and connection subscriptions are connected. DOM and editor tests cover staged actions. A real Host browser scenario verifies the atomic authorization payload, successful response and persistence after reload; live reconnect browser acceptance remains pending.

<a id="model-experience"></a>
## Model Experience

### Browser presentation

#### What the model sees

`@deepseek-ai/dsh-qs-ui-settings-plugins` adds no model messages or tool definitions.

#### Token effect

No additional prompt tokens.

#### KV Cache effect

The row does not construct model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Shell and AgentLoop numeric cards stage edits locally and save all edited fields with the initial revision. Conflicts preserve drafts; adopting the current revision requires an explicit action. Reset removes the user override. The subagent authorization card is connected; WebSearch is connected; real Host save and credential-only retry have browser coverage. Inventory belongs to a separate plugin. Real Host browser checks cover numeric saves and persistence after reload. Full configuration acceptance remains pending.

### Dev Note

Keep page state inside the owning contribution. The navigation must not duplicate settings mirrors or credential storage.
