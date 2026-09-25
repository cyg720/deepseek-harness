# Agent Note: 桌面运行时 ZIP 链接

Status: implemented

[English](2026-09-23-desktop-runtime-zip-links.md) | 中文

## Problem

Windows Desktop 构建使用 extract-zip 解压 Node 分发包。其符号链接公告涉及指向解压目录之外的目标，以及后续普通条目通过此前同名符号链接写入。若本地攻击者可以同时替换归档与缓存清单，对比两者摘要并不能认证文件来源。

## Decision

奇术解压适配器在 onEntry 中拒绝 Unix 符号链接条目，早于 extract-zip 创建链接。调用方持有全新、独占的空输出目录。Node ZIP 分发包不需要符号链接能力；不支持的链接条目使准备失败，而不是被静默忽略。

## Alternatives considered

**检查父目录后接受链接。** 这不能阻断最终路径分量的同名覆盖攻击。

**将依赖审计视为已修复。** 调用点缓解不改变安装的依赖及其公告。上游维护版本修补后，只有等价回归覆盖验证实际分发版本，才能用上游实现替换适配器。

## Consequences

此策略覆盖 Node ZIP 准备调用点，不覆盖任意归档、tar 解压、归档来源真实性或资源耗尽限制。真实 ZIP 夹具覆盖普通内容、越界链接及同名条目，不要求宿主允许创建符号链接。
