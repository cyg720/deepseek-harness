---
description: "Qishu workbench transcript: keyed chat-node rows, the interaction chain host, and history paging."
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-transcript

English | [中文](README.zh.md)

## Summary

Read user messages, assistant output, and pending interaction cards in the workbench. Assistant prose uses the official Markdown renderer, including code blocks and sanitized links; unrecognized records remain inspectable.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

Mount `@deepseek-ai/dsh-qs-transcript` with the other Qishu plugin rows in the [Web bundle](../../bundle/web-app/cordis.patch.yml). The package has no deployment configuration fields.

System prompts, reference context, reasoning, and unknown extension payloads start collapsed and expand into bounded, wrapping text panels. Closed-turn process rows show recorded activity counts; footers show completion and exact token totals when available, without repeating the answer. These disclosures affect presentation only and do not remove context from model requests. Unknown payloads are serialized only while expanded; closing releases their formatted display text.

Sending a message or steering restores following. Passive output and historical prepends preserve a reader who has scrolled away. Programmatic scrolling is immediate, and its delayed scroll events do not cancel following when content grows.

History loading and failures have visible status; retry reconnects the official transport. Each Session binding retains its reading position in memory across view switches. Loading earlier history preserves the visible row anchor. Whole-message copying includes user text or assistant prose, excluding reasoning.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

Rows subscribe to keyed chat-node sources; history reads the Session snapshot. Resize observation covers output and interaction cards. The official conversation projection owns durable records, so this presentation package publishes no runtime invariant companion.

</details>

No runtime invariant companion is published because the official services own the authoritative session data and this package only presents it.

<a id="model-experience"></a>
## Model Experience

### Browser presentation

#### What the model sees

`@deepseek-ai/dsh-qs-transcript`: this browser presentation delegates user actions to official services without constructing model requests.

#### Token effect

This package adds no prompt or tool-schema tokens of its own; official services handle user-submitted content.

#### KV Cache effect

None; neither entry assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Specialized tool presentations use a generic payload fallback. Image blocks and other non-text history display an explicit limitation notice; their original records remain intact. Markdown supports HTTP(S) images and absolute POSIX/Windows local image paths through the official authenticated file API; relative paths, attachment galleries, and prose file-mention actions are not implemented here.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

Validation status is recorded in the [review repair log](../../../qishu/PRD/1-AI工作台/复核测试/02-复核修复与全量验证.md).

</details>
