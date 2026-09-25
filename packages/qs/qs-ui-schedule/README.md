---
description: "Read-only active Session reminders."
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-ui-schedule

English | [中文](README.zh.md)

## Summary

Read active reminders with their local target time, recurrence and overdue indication.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

This independent ui-schedule counterpart contributes to the Qishu conversation header. It requires the official Schedule projection and an open Session with active records. The Web bundle resolves the package but disables it by default. The Qishu Schedule patch enables both presentations with one official Schedule owner; the real Host browser test replays active records and removes them through persisted changes.

<a id="understand-the-implementation"></a>
## Understand the implementation

The plugin reads the complete schedule projection without RPC or mutation. Local target times include the UTC offset, and each row exposes its original UTC timestamp for comparison during daylight-saving overlaps. Browser time only formats local and relative targets; it never runs reminders. Records sort by target time with stable ties. Only an open catalog runs a clock. Session changes reset the popover. No invariant companion is published because this view owns no independent domain state.

<a id="model-experience"></a>
## Model Experience

### Browser presentation

#### What the model sees

`@deepseek-ai/dsh-qs-ui-schedule` only presents the durable Schedule projection; no model-visible input.

#### Token effect

No additional prompt or tool-schema tokens.

#### KV Cache effect

None; the view does not construct provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The catalog is read-only and contains active records only. Delivery history stays in the transcript. Browser overdue labels do not establish execution failure. Creation and cancellation controls are not exposed by this read-only view.

### Dev Note

Escape closes the catalog and restores trigger focus; outside pointer presses dismiss it.
