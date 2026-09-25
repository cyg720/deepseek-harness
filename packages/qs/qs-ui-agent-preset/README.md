---
description: "Qishu agent preset directory and presentation."
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-ui-agent-preset

English | [中文](README.zh.md)

## Summary

Read the official agent-preset roster through one plugin-owned directory, retaining default, trust and broken-row facts.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

The independent counterpart of ui-agent-preset is mounted in the QS Web profile. Its settings directory uses the QS settings section slot and renders Host labels as text.

<a id="understand-the-implementation"></a>
## Understand the implementation

Reset retains interrupted preparation across roster refreshes and ignores the old RPC reply. Unloading the preset contributor leaves a failure in the composer registry; re-enable it and explicitly retry selection, or reload and confirm the session preset. A successful retry restores availability without replaying a cancelled first message.

Reads use the official agentPresets and settings Remotes. A newer refresh supersedes older replies; reset and disposal invalidate pending reads. A missing opener capability does not hide a valid roster. A missing preset service or empty roster is unavailable, while a refused or failed read is an error. No invariant companion is published because this presenter owns no independent Host state to reconcile.

The settings controls submit one default or modeSelectionEnabled field through settings.mutate with the displayed revision. The writer refuses writes without a writable settings description, isolates replies across connection resets and disposal, and preserves newer pushed revisions. Broken presets are not selectable; a disabled picker prevents default selection. Successful saves refresh the Host effective roster without changing existing sessions.

The selection controller stages a healthy preset before a session exists, then applies it only to a blank session. Directory changes invalidate unavailable choices. Replies cannot publish another session's selection after navigation, reset or disposal. The welcome selector subscribes to the official session list; the header label reads each session's recorded projection. Removing the QS welcome slot clears staged choices.

A directory refresh restores a still-valid staged selection in the picker even when no session exists yet; it does not silently replace that selection with the effective default.

An active selection publishes preparation for the exact RPC target to qsSendPreparation. QS submission waits for success; selection failure remains visible and prevents sending under an unconfirmed preset. A request targeting another session does not block the current session.

A policy save captures the current blank session and connection generation before writing. After persistence succeeds, the Host effective default is read again and synchronized only if that same session is still blank and current. Synchronization failure is reported separately from successful settings persistence. Refreshing the directory retains mounted controls so a partial-failure notice survives the refresh.

<a id="model-experience"></a>
## Model Experience

### Browser directory

#### What the model sees

This presenter adds no model message or tool. `agentPresets.list` reads the roster without changing any session composition.

#### Token effect

No additional prompt tokens.

#### KV Cache effect

The directory does not construct model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- First-send waiting and failure are covered by DOM tests, and a delayed real preset request blocks browser submission. The staged first-send browser regression pauses the real preset RPC and verifies that its persisted selection precedes the sole user-originated message. A real-browser regression unloads the Host preset provider while selection is pending, restores the same Loader entry, and verifies retained input, zero prompts and a durable successful retry. Registry, plugin lifecycle and DOM regressions also cover interruption, remount and explicit retry. Copy/delete, composition viewing, directory opening and conversational authoring require alignment with the approved scope before implementation.

### Dev Note

A running session retains its initial composition. The default and selection policy concern future sessions; directory display alone does not prove these operations are available.
