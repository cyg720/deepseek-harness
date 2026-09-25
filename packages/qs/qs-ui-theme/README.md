---
description: "Qishu appearance and font-size selection over the official theme service."
kind: "package-reference"
---

# @deepseek-ai/dsh-qs-ui-theme

English | [中文](README.zh.md)

## Summary

Select appearance and content font size in Qishu settings using the official theme service.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

This independent counterpart of ui-theme contributes separate appearance and font-size rows to qs.settings.general.item. The official theme service remains the sole preference owner. No extra plugin configuration is required.

<a id="understand-the-implementation"></a>
## Understand the implementation

The rows read ThemeSnapshot and delegate to setTheme and setFontSize without duplicating state or persistence. Host loading and read-only states disable the controls; memory connections allow explicitly temporary choices. Unloading releases rows, dictionaries and subscriptions without disposing the official service. No invariant companion is published because preference ownership remains with that service.

<a id="model-experience"></a>
## Model Experience

### Browser presentation

#### What the model sees

`@deepseek-ai/dsh-qs-ui-theme` adds no model messages or tool definitions.

#### Token effect

No additional prompt tokens.

#### KV Cache effect

The row does not construct model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Selection changes the current interface immediately. The official setTheme/setFontSize command does not return a persistence acknowledgement; the row does not claim a successful save. Durable write-failure feedback remains part of the full settings acceptance work.

### Dev Note

The 12–17px integer options match the official acceptance range; tests compare every option with the official constants. The system preference remains distinct from its resolved light or dark scheme.
