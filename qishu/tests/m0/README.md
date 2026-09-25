# M0 isolation probes

English | [中文](README.zh.md)

This directory contains development probes against the real slot kernel and registry. These are not static UI prototypes and do not establish full QS plugin acceptance.

Run from the repository root:

```powershell
node node_modules/vitest/vitest.mjs run --config qishu/tests/m0/m0.config.ts
node node_modules/typescript/bin/tsc -p qishu/tests/m0/tsconfig.m0.json
```

Tests use source aliases; type checking uses dependency declarations through project references and requires building dependencies first. Commit test sources and configuration. Keep raw JSON reports, logs, and coverage pages local; record reviewed conclusions under `qishu/PRD/1-AI工作台/复核测试`.
