---
description: "Qishu workbench plugin family."
kind: "package-group"
---

# Qishu workbench

English | [中文](README.zh.md)

## Summary

The Qishu plugins provide the workbench shell, static sign-in, brand and sidebar presentations, session navigation, composer, transcript, tool presentation, approvals, and questions. They use the [client modules subsystem](../../docs/subsystems/client-modules.md) and preserve the official interface as a configurable alternative.

## Packages

- [qs-ui-model-selection](qs-ui-model-selection/README.md): Model and effort selection over the official shared directory; acceptance pending.

- [qs-shell](qs-shell/README.md)
- [qs-login](qs-login/README.md)
- [qs-ui-brand](qs-ui-brand/README.md)
- [qs-ui-sidebar](qs-ui-sidebar/README.md)
- [qs-ui-sidebar-right](qs-ui-sidebar-right/README.md)
- [qs-sessions](qs-sessions/README.md)
- [qs-composer](qs-composer/README.md)
- [qs-transcript](qs-transcript/README.md)
- [qs-ui-tool](qs-ui-tool/README.md)
- [qs-approval](qs-approval/README.md)
- [qs-questions](qs-questions/README.md)

The [command candidate plugin](qs-ui-input-trigger/README.md) corresponds to official ui-input-trigger and reuses its controller.

- [qs-ui-commands](qs-ui-commands/README.md): Command options and risk confirmation over the official command controller.
- [qs-ui-permission-presets](qs-ui-permission-presets/README.md): Current-session permission options and new-session defaults with official-interface fallback.

- [qs-ui-message-feedback](qs-ui-message-feedback/README.md): Message ratings and session feedback through the shared official owner.

- [qs-ui-deliverables](qs-ui-deliverables/README.md): Delivered file cards and present-tool status over the shared official controller.

- [qs-ui-goal](qs-ui-goal/README.md): Goal status and revision-aware actions over the official shared service.
- [qs-ui-subagent](qs-ui-subagent/README.md): Child catalog, navigation and read-only composer using official Session services.
- [qs-ui-directory-picker-native](qs-ui-directory-picker-native/README.md): Native OS directory selection over the official Host capability.
- [qs-ui-directory-picker-browse](qs-ui-directory-picker-browse/README.md): Host directory navigation and creation through the official workspace service.
- [qs-ui-agent-preset](qs-ui-agent-preset/README.md): Shared preset directory; selection and management actions remain pending.
- [qs-ui-settings-models](qs-ui-settings-models/README.md): Provider directory over shared official model settings; editing and Web assembly remain pending.
