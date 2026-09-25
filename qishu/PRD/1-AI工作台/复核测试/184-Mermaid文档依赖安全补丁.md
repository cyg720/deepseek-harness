# Mermaid 文档依赖安全补丁

日期：2026-09-24。本批修补实际用于仓库图表校验和文档网站的依赖：Mermaid 11.16.0 → 11.16.1，DOMPurify 3.4.11 → 3.4.13。未调整工作台界面、插件装配、服务接口或 Session 数据。

## 变更范围

根与 website 两份 package.json 保持相同 Mermaid 精确版本。Mermaid 的 DOMPurify 声明为宽范围 ^3.3.3，现有锁定项可能继续命中旧版，因此在 pnpm-workspace.yaml 增加只覆盖 DOMPurify 3.x 旧版的定向 override，并附中文说明。没有使用 audit fix 批量升级。

与上一轮全量测试容器保存的锁文件相比，本批差异仅包含上述两个版本、完整性哈希、override 和 Mermaid 的 peer 引用；未改变其他依赖版本。精确差异保存于 `logs/repair-v1-mermaid-lock.diff`。官方原文件四项登记于 [104](../../../官方源码改动记录清单/104-Mermaid文档依赖安全补丁登记.md)，总表增加 website/package.json 后为 212 项；QS 报告不纳入官方清单。

## 验证

| 检查 | 实际结果 | 日志 |
| --- | --- | --- |
| registry 精确版本查询 | Mermaid 11.16.1、DOMPurify 3.4.13 均存在 | 终端输出 |
| pnpm install --lockfile-only | 退出 0，保留供应链策略；有 peer 与弃用依赖提示 | `logs/repair-v1-mermaid-lock.log` |
| pnpm install --frozen-lockfile | 退出 0，实际替换 3 个依赖目录；安装钩子完成 | `logs/repair-v1-mermaid-install.log` |
| pnpm run verify-mermaid | 退出 0，扫描 1710 文件，20 个图表解析成功 | `logs/repair-v1-mermaid-parse.log` |
| pnpm run website:build | 退出 0，客户端/服务端构建和页面渲染成功；2668 片段引用有效，201 个原始 Markdown 与 llms.txt 生成 | `logs/repair-v1-mermaid-website.log` |
| pnpm audit --json | 退出 1，0 critical、2 high、12 moderate、1 low | `logs/repair-v1-mermaid-audit.json` |
| pnpm run doc-sync | 退出 0，34 项通过、0 失败、0 跳过，55.44 秒 | `logs/repair-v1-mermaid-docs.log` |

官方总表已校验 212 个唯一文件按路径排序且序号连续，本批四个文件全部存在；新增报告的 UTF-8、LF 与单个结尾换行检查通过，相关已跟踪文件 git diff --check 退出 0。

相较 [183](183-剩余依赖公告可达性核查.md)，本批减少 5 项中危和 2 项低危，Mermaid、DOMPurify 不再出现在本次扫描公告中。这证明锁定版本不再命中该次公告库，不代表完整渗透测试通过。

网站构建仍提示部分 chunk 大于 500 kB；该提示未被屏蔽，也不计为性能通过。此次验证包含图表语法和网站构建，不声称已逐图完成真实浏览器视觉验收。没有对文档依赖补丁重复运行全部业务覆盖率；此前业务证据见 [182](182-同页面连接重装与作用域恢复.md)，最终整体验收仍需匹配完整最终版本。

extract-zip 的两项高危仍保留，既有直接调用点防护未移除。本批没有修改其余安全公告的状态。没有提交或推送 Git。
