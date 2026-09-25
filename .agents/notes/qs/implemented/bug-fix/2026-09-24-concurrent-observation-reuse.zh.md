# Agent Note: 并发观察复用

Status: implemented

[English](2026-09-24-concurrent-observation-reuse.md) | 中文

## Problem

多个冷 Session 观察可能在等待持久化之前同时未命中准备缓存。即使其他读取者已经发布可复用条目，为每份返回日志重新准备实例仍会重复恢复同一修订的投影。

## Decision

观察读取器在读取句柄关闭、取消检查完成且排除实时挂载后，再次检查既有缓存；仅复用同一持久化实例和同一修订。Cordis 追踪代理通过原始服务身份比较，实际 I/O 仍使用追踪代理。每个观察仍独立拥有租约。此决策明确了[观察架构](../../../implemented/architecture/2026-08-25-session-observations-and-projection-owned-client-state.zh.md)中的并发冷读取部分；原笔记仍负责不可变观察切面、投影与提升规则。

## Alternatives considered

共享在途磁盘工作还需要管理独立等待者取消和服务释放。已测得的重复投影工作无需增加这些状态即可消除。磁盘读取保持独立，此决策不承诺合并在途 I/O。修改令牌估算或截断历史会改变行为，不能替代删除重复准备工作。

## Consequences

同修订的并发读取共享准备内容，不同修订仍彼此隔离。既有取消、损坏处理、实时优先、租约和淘汰行为仍须满足。可控重叠读取回归必须能拒绝重复准备，真实浏览器负载须验证恢复次数下降是否改善打开耗时。CPU profile 仅作诊断，不计入计时中位数。
