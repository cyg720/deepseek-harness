# Agent Note: Qishu workspace scaffolds

Status: implemented

[English](2026-09-17-qs-workspace-scaffolds.md) | 中文

## 问题

奇术工作台需要七个独立插件，同时保持仓库现有包发现深度。框架不应在默认 Web 组合中启用未完成界面。

## 决策

七个工作区包位于 packages/qs/qs-{shell,login,sessions,composer,transcript,approval,questions}。每包包含空的 Host 与 Client apply 入口、共享客户端 TypeScript 配置及官方 clientBundle 预设。客户端聚合工程与生成的源码别名包含这些包。[框架说明](../../../../../packages/qs/FRAMEWORK.md) 仅为文档。

## 考虑过的替代方案

- 在 workbensh 下嵌套七包需要改变工作区发现与源码别名生成，超出框架范围。
- 一个包内放七个模块不能保持用户选定的独立包划分。
- 把占位入口挂进默认 Web profile 会暗示运行接线已经完成；组合行及其解析依赖留待后续实现。

## 影响

这些包不含视图、槽、配置、服务或模型可见副作用。空入口无需 invariant 伴随模块。运行依赖与行为测试属于引入相应行为的实现；结构就绪通过类型编译、打包与包门禁检查。开发计划仍是未实现功能的依据。

填充这些包的实现见[奇术工作台客户端插件家族](2026-09-17-qishu-workbench-client-plugins.zh.md)。
