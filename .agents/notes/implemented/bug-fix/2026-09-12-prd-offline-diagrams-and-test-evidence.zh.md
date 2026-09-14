# Agent Note: 离线 PRD 图形与测试证据

Status: implemented

[English](2026-09-12-prd-offline-diagrams-and-test-evidence.md) | 中文

## Problem

PRD 读者需要在同一份可编辑、可导出的离线文档中看见图形。仅有覆盖矩阵无法告诉测试人员应生成哪些输入、执行哪些步骤或收集哪些证据。

## Decision

[PRD 撰写技能](../../../../applications/PRD/skills/prd-writer-v3.1/prd-writer/SKILL.md) 要求原位 Mermaid 图形及可分别追溯的 TC、TD 和 AC 记录。生成夹具保持为合成数据；缺失业务适配或决策会阻断受影响的业务验收，但不阻止本地夹具生成。

[构建器](../../../../applications/PRD/skills/prd-writer-v3.1/prd-writer/scripts/render_prd.py) 校验固定的 Mermaid 资源并连同许可证内嵌。Markdown 仍是导出正文依据；SVG 从当前快照重新生成。渲染丢弃过期修订，隔离图形错误，并禁用文档配置、外部资源和交互。CSP 哈希仅授权随包的可执行脚本。

## Alternatives considered

CDN 或相邻脚本破坏单文件离线交付。独立图示页面使编辑内容与图形结果分离。仅保存生成 SVG 会丢失可编辑源码；把数据生成视为业务测试会夸大证据。

## Consequences

库为每份 HTML 增加约 3.4 MiB。升级需要更新资源哈希、许可证及浏览器回归证据。[测试](../../../../applications/PRD/skills/prd-writer-v3.1/prd-writer/scripts/test_runtime.py) 覆盖离线文件打开、编辑、导入导出、竞争渲染与非法输入；[夹具测试](../../../../applications/PRD/skills/prd-writer-v3.1/prd-writer/scripts/test_test_data.py) 执行文档中的生成方法并检查可重复性与引用。这些检查不批准业务需求，也不认证所有浏览器或 Mermaid 语法。
