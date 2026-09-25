---
description: "Qishu language selection over the official locale service."
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-locale

English | [中文](README.zh.md)

## Summary

Select the interface language in Qishu settings using the official language registry.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

The independent counterpart of the official locale settings row contributes to qs.settings.general.item. The Web bundle retains the official locale service as its sole language and preference owner. No extra plugin configuration is required.

<a id="understand-the-implementation"></a>
## Understand the implementation

The row reads registered language names and the active selection directly from the official service. Selection delegates to setLocale without duplicating its store or persistence. Host loading and read-only states disable the control; memory connections allow an explicitly temporary choice. Removing the presentation releases its slot and dictionary without disposing the official language service. No invariant companion is published because registry and preference ownership remain with that service.

<a id="model-experience"></a>
## Model Experience

### Browser presentation

#### What the model sees

`@deepseek-ai/dsh-qs-locale` adds no model messages or tool definitions.

#### Token effect

No additional prompt tokens.

#### KV Cache effect

The row does not construct model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Selection changes the current interface immediately. The official setLocale command does not return a persistence acknowledgement; the row does not claim a successful save. Durable write-failure feedback remains part of the full settings acceptance work.

### Dev Note

Language packs extend the official registry. Do not hardcode a separate list of supported languages in this presentation.
