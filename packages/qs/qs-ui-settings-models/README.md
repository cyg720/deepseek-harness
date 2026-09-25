---
description: "Qishu model settings over the shared official service."
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-ui-settings-models

English | [中文](README.zh.md)

## Summary

Shows provider registration, configuration, and confirmed credential state in the Qishu settings layout, with connection editing for DeepSeek and pi-ai providers.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

Requires the official modelsSettings service and Qishu settings shell. No deployment configuration fields. This package is not mounted in the shipped Web profile yet.

<a id="understand-the-implementation"></a>
## Understand the implementation

The official `modelsSettings.face` supplies the existing controller. Provider and footer slots correspond to official extensions. Failed loads keep prior rows and display generic retry notices. No invariant companion is published because this presenter owns no independent authoritative state.

The provider writer acknowledges configuration revisions before storing credentials. Credential failure preserves the committed configuration; callers recompute path operations from that acknowledged view before retrying. Disposal prevents subsequent writes and UI acknowledgements but cannot undo an RPC already sent. The connection editor submits only endpoint overrides and explicit credential references; blank keys retain stored credentials. Empty native-authentication routes are explicitly materialized when first configured.

Provider removal confirms the route and unsets only its user configuration with the observed revision. Keys are retained by default. Explicit credential removal is offered only for the writable conventional reference when no other directory row names it; that step precedes configuration removal. A retry after partial success never repeats the confirmed credential deletion.

The model catalog edits IDs, names and token capacities while preserving other model fields. K/M capacity suffixes use decimal units; invalid or duplicate rows block saving. Restoring inheritance unsets the user array and displays deployment or schema defaults. A successful configuration acknowledgement clears the submitted model delta, so credential retries cannot replay it because the Host reordered object keys.

For pi-ai providers, model discovery queries the current draft endpoint, protocol and optional write-only key without storing them. Candidate filtering and selection only add explicitly adopted, missing models to the draft. Changing request fields or unmounting invalidates prior replies; failures remain retryable without exposing raw diagnostics.

The custom-provider card obtains protocol choices from the official schema. Creation requires an unused lowercase route ID, an HTTP(S) endpoint and at least one valid model. It writes the profile with the opening revision, then stores an explicitly supplied credential. After configuration commits, profile fields lock and retries only store the key. A newer observed namespace view outranks a late creation acknowledgement when checking the credential reference.

Declared pi-ai providers can edit display names and schema-supported protocols without changing route IDs. A blank name removes only the user override. Discovery uses the draft protocol; unsupported or absent protocols require an explicit valid choice before saving or querying. Built-in provider routes do not expose route-level protocol overrides.

<a id="model-experience"></a>
## Model Experience

### Provider directory

#### What the model sees

Directory reads do not change model requests. Saved provider endpoints and credentials affect subsequent provider requests through `modelsSettings.face.operations`.

#### Token effect

No additional prompt tokens.

#### KV Cache effect

Directory reads do not change caches. Provider configuration changes follow the official adapter reload behavior.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The welcome-notice step uses the official versioned text and acknowledgement controller; failures remain retryable and disposed steps ignore late responses. The independent DeepSeek step skips when any provider is usable, writes only the named credential and reloads the shared directory before completion. The shipped Web bundle mounts the plugin. Real-Host browser tests cover first-run acknowledgement, credential persistence without echo, endpoint edits and reload. Real-Host coverage also verifies custom-provider create/edit/reload/delete, retained drafts after transport failures, default key retention and explicit key deletion without affecting other credentials. Acknowledged reloads do not open either onboarding dialog while facts load. A 390px real-browser scenario covers endpoint discovery through the official adapter, retry after endpoint refusal, long candidate names without dialog overflow, adoption, persistence and duplicate prevention. Two official/QS root-switch cycles verify bidirectional saved settings. A concurrent official-page write rejects a stale QS draft without discarding it or overwriting persisted values; reload adopts the latest revision. The remaining W10 surfaces and full acceptance are still pending.

### Dev Note

Use official settings revisions and credential operations; do not reconstruct entire namespaces from redacted descriptors.
