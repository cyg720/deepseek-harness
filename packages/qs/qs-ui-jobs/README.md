---
description: "Read-only Session background jobs."
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-ui-jobs

English | [中文](README.zh.md)

## Summary

Read-only jobs with shared control status and recovery.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

The Web profile mounts this independent ui-jobs counterpart under the Qishu conversation header. No package-specific configuration.

<a id="understand-the-implementation"></a>
## Understand the implementation

The plugin reads jobsBySession and ISessions.control, without polling or copying the registry. It shows five states, producer detail, UTC timestamps and duration. Missing details or results remain explicit. Only an open, connected list with live work runs a clock. Session changes reset the popover. The official owner serializes terminal retries; carrier reconnection stays automatic. No invariant companion is published because this view owns no independent domain state.

The internal notification tracker compares observed live and terminal job states within a bounded identity set. Initial terminal rows, changed control baselines, changed Host identities and cleared observations are silent. It retains neither result bodies nor persistent read state. The plugin observes accessed, still-addressable sessions through the shared control and list sources and displays localized terminal notices through qsToast while the workbench is active. Logout and disposal clear notices and queued work. The shell notificationCapacity bounds remembered identities and visited sessions. It never creates an additional control stream.

<a id="model-experience"></a>
## Model Experience

### Browser presentation

#### What the model sees

`@deepseek-ai/dsh-qs-ui-jobs` only presents process-local job state; no model-visible input.

#### Token effect

No additional prompt or tool-schema tokens.

#### KV Cache effect

None; the view does not construct provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Cancellation, restart, generic progress and result navigation are not provided by this read-only view. Complete second-priority acceptance remains separate work.

### Dev Note

Returning to the session closes the current-session popover and restores its trigger focus.
