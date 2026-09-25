# 桌面运行时 ZIP 限制登记

日期：2026-09-23；工作区 HEAD `4904755062`，待提交。

| 官方文件 | 是否必须改动 | 原因和作用 | 验证状态 | 上游影响 |
| --- | --- | --- | --- | --- |
| `apps/desktop/scripts/prepare-runtime.ts` | 是 | Windows Node ZIP 改为调用 QS 受限解压入口，在创建符号链接前拒绝条目，缓解 extract-zip 两项符号链接公告 | 3 项真实 ZIP 测试通过，负向对照有效；实际 Node 准备、typecheck、doc-sync 通过 | 仅 Windows 构建准备路径；依赖仍有公告，不等于升级修补；上游修补后可评估移除 QS 防护 |

| `apps/desktop/README.md` | 是 | 说明 Windows ZIP 链接限制 | doc-sync 通过 | 上游合并保留实际解压约束 |
| `apps/desktop/README.zh.md` | 是 | 同步中文行为说明 | 配对及 doc-sync 通过 | 与英文同步 |

| `apps/desktop/README.i18n.yaml` | 是 | 记录修改后的双语对；生成元数据不插入注释 | 已重新生成，doc-sync 通过 | 与 README 对同步生成 |

局部中文注释说明拒绝链接的原因。受限解压模块与测试位于官方目录的 `qs/` 子目录，不登记为官方原文件。当前增加四个官方原文件，总计 183 个，181 项保留、2 项已还原。

[查看累计差异](98-桌面运行时ZIP限制差异.html)。详细证据见 [172 验证记录](../PRD/1-AI工作台/复核测试/172-桌面ZIP安全缓解验证.md)。
