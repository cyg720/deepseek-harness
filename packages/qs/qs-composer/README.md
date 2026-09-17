---
description: "Build-only scaffold for Qishu message composition."
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-composer

English | [中文](README.zh.md)

## Summary

Developers can compile and bundle the empty message composition plugin. It has no user-visible behavior and is not mounted in the default Web composition.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

This is a development scaffold, not an installable application. See the [framework map](../FRAMEWORK.md) for package locations and scope.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

Both [Host](src/index.ts) and [Client](src/client/index.ts) export an empty named apply function. The TypeScript project uses the shared client configuration; the bundle uses the official clientBundle preset. No runtime invariant companion is published because neither entry owns state or independently observable relationships.

</details>

<a id="model-experience"></a>
## Model Experience

None, as both scaffold entries register nothing model-facing.

#### KV Cache effect

None; neither entry assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Views, configuration, services, locale dictionaries, and behavior tests are not implemented.
- Default Web mounting and its dependency edge are deferred until runtime implementation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

The [first-priority plan](../../../qishu/dev-components/第一优先开发计划评审/00-评审总纲.md) defines future functionality; its milestones are not completed by these placeholders.

</details>
