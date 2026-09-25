---
description: "Session goal presentation using official goal services."
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-ui-goal

English | [中文](README.zh.md)

## Summary

Present durable goal status and revision-aware actions in the Qishu composer dock.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

This independent ui-goal counterpart requires the official goalPresentation provider, goal projection, Remote services and Qishu composer/transcript slots. The shipped Web profile registers it independently; slot declarations keep it dormant while the official interface is selected.

<a id="understand-the-implementation"></a>
## Understand the implementation

Clearing requires a modal confirmation of the displayed objective. Cancel and Escape do not submit; confirmation sends the captured GoalRef so Host CAS rejects a newer revision. Changing session or goal closes the confirmation.

Creation uses goals.create with a literal objective. Edit captures the displayed GoalRef. A stale-revision failure preserves the draft and locks saving until an explicit successful refresh; failed refresh keeps the lock. Refresh never submits or retargets the draft to another goal. Session or goal identity changes discard local state and fence late results. Durable phase and process activation remain separate; completed objectives and literal round counts stay visible. No invariant companion is published because the view owns no independent domain state.

<a id="model-experience"></a>
## Model Experience

### Browser presentation

#### What the model sees

The view creates no new model messages or history definitions. Official goal mutations retain their existing `goal/change` log and model-context behavior.

#### Token effect

No additional prompt or tool-schema tokens from the presentation.

#### KV Cache effect

The view does not construct provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The form edits objective text only; it does not change the round cap. Browser acceptance and wider workbench checks are recorded separately from component coverage.

### Dev Note

Pending mutations are single-flight. The history row decorates only the leading executed command token and renders objective mentions as text.
