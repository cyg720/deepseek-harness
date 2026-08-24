/**
 * 文件职责：快照验证正式应用中 dsh-badge 技能的默认禁用与显式启用行为。
 * 技术维度：使用 Loader 冒烟运行器、内联快照和路径归一化比较完整模型可见输出。
 * 产品维度：保证徽章技能只在用户选择后出现，并向代理提供稳定且官方的使用说明。
 * 逻辑维度：分别启动默认和启用配置，解析输出，替换机器路径后对比目录与技能内容快照。
 * 关键边界：本地资源绝对路径必须替换为占位符；两个运行都需使用真实装配配置。
 * 新手阅读建议：先看五个路径常量，再比较 disabledSnapshot 与 enabledSnapshot 的结构差异。
 */
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
/** 技能快照夹具的源启动脚本。 */
const binScript = fileURLToPath(new URL('./fixtures/dsh-badge/snapshot.ts', import.meta.url))
/** 显式启用徽章技能的装配配置。 */
const configPath = fileURLToPath(new URL('./fixtures/dsh-badge/cordis.yml', import.meta.url))
/** 保持徽章技能禁用的默认装配配置。 */
const defaultConfigPath = fileURLToPath(new URL('./fixtures/dsh-badge/default.cordis.yml', import.meta.url))
/** 冒烟运行源码入口时使用的仓库 TypeScript 配置。 */
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
/** 快照输出中需要归一化的徽章资源绝对目录。 */
const badgeAssetsPath = fileURLToPath(new URL('../../../packages/skill/skill-badge/assets/', import.meta.url))

describe('dsh badge assembled snapshot', () => {
  /** 默认装配应报告技能不可用，启用装配应公布并加载完整官方说明。 */
  it('advertises and loads the opt-in bundled skill through the shipped app', async () => {
    /** 使用默认配置运行得到的禁用技能结果。 */
    const disabled = await runLoaderSmoke({
      label: 'disabled dsh badge skill snapshot',
      tempDirPrefix: 'headless-snapshot-dsh-badge-disabled-',
      binScript,
      libBinScript: binScript,
      configPath: defaultConfigPath,
      tsconfigPath,
    })
    /** 使用显式启用配置运行得到的技能目录和加载结果。 */
    const enabled = await runLoaderSmoke({
      label: 'dsh badge skill snapshot',
      tempDirPrefix: 'headless-snapshot-dsh-badge-',
      binScript,
      libBinScript: binScript,
      configPath,
      tsconfigPath,
    })
    /** 默认输出解析出的结构化快照值。 */
    const disabledSnapshot = JSON.parse(disabled.stdout) as unknown
    /** 启用输出解析并归一化资源路径后的结构化快照值。 */
    const enabledSnapshot = JSON.parse(
      enabled.stdout.replaceAll(badgeAssetsPath, '{{badgeAssetsPath}}'),
    ) as unknown

    expect(disabled.stderr).toBe('')
    expect(enabled.stderr).toBe('')
    expect(disabledSnapshot).toMatchInlineSnapshot(`
      {
        "catalog": null,
        "result": {
          "content": [
            {
              "text": "Error: skill "dsh-badge" is unknown or no longer available",
              "type": "text",
            },
          ],
          "error": {
            "message": "skill "dsh-badge" is unknown or no longer available",
          },
          "isError": true,
        },
        "summary": null,
      }
    `)
    expect(enabledSnapshot).toMatchInlineSnapshot(`
      {
        "catalog": [
          {
            "text": "<system-reminder>
      A skill is a reusable set of task-specific instructions. The following skills are available in this session:

      <available_skills>
      - \`dsh-badge\`: Add the official “powered by dsh” badge to documents, pull requests, merge requests, and other content produced with DeepSeek Harness. Use whenever creating a pull request or merge request. Also use when the user asks for a dsh badge, powered-by-dsh attribution, or a reusable dsh badge asset or snippet.
      </available_skills>

      If the user names a skill, or the task clearly matches a skill's description, call the \`skill\` tool with the exact skill name before taking task actions. Load all applicable skills, then follow their full instructions. This catalog contains summaries only; do not infer or follow a skill's instructions until it has been loaded.
      A user may also invoke a skill directly; its <skill_content> block then appears in this conversation. Follow it, and do not call the \`skill\` tool again for that skill.
      </system-reminder>",
            "type": "text",
          },
        ],
        "result": {
          "content": [
            {
              "text": "<skill_content name="dsh-badge">
      <skill_resources>
      Base directory for this skill: {{badgeAssetsPath}}
      Resolve relative paths mentioned by this skill against the base directory before using them. Load referenced resources only as needed.
      </skill_resources>

      <skill_instructions>
      # dsh Badge

      Add the official “powered by dsh” badge without recreating or restyling it.

      ## Assets

      - Local PNG: [\`dsh-badge.png\`](dsh-badge.png), 726×120 source image; render at 121×20
      - Shields.io image URL: \`https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white\`
      - Project URL: \`https://github.com/deepseek-ai/deepseek-harness\`

      ## Markdown

      Use this linked badge in Markdown:

      \`\`\`markdown
      [![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
      \`\`\`

      If attribution should not be linked, use:

      \`\`\`markdown
      ![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)
      \`\`\`

      ## Usage rules

      - For GitHub or GitLab Markdown, use the Shields.io URL and link it to the project URL unless the user asks for an unlinked image.
      - For Feishu and other systems that import remote images unreliably, upload \`dsh-badge.png\` from this skill directory instead of generating another badge.
      - Preserve the badge's 121×20 dimensions and aspect ratio.
      - Place the badge at the end of the attributed document or section unless the user specifies another position.
      - Do not substitute another color, logo, label, or project URL.

      </skill_instructions>
      </skill_content>",
              "type": "text",
            },
          ],
          "isError": false,
          "value": {
            "content": "# dsh Badge

      Add the official “powered by dsh” badge without recreating or restyling it.

      ## Assets

      - Local PNG: [\`dsh-badge.png\`](dsh-badge.png), 726×120 source image; render at 121×20
      - Shields.io image URL: \`https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white\`
      - Project URL: \`https://github.com/deepseek-ai/deepseek-harness\`

      ## Markdown

      Use this linked badge in Markdown:

      \`\`\`markdown
      [![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
      \`\`\`

      If attribution should not be linked, use:

      \`\`\`markdown
      ![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)
      \`\`\`

      ## Usage rules

      - For GitHub or GitLab Markdown, use the Shields.io URL and link it to the project URL unless the user asks for an unlinked image.
      - For Feishu and other systems that import remote images unreliably, upload \`dsh-badge.png\` from this skill directory instead of generating another badge.
      - Preserve the badge's 121×20 dimensions and aspect ratio.
      - Place the badge at the end of the attributed document or section unless the user specifies another position.
      - Do not substitute another color, logo, label, or project URL.
      ",
            "name": "dsh-badge",
            "provider": "dsh-badge",
            "resourceBase": {
              "kind": "directory",
              "path": "{{badgeAssetsPath}}",
            },
          },
        },
        "summary": {
          "description": "Add the official “powered by dsh” badge to documents, pull requests, merge requests, and other content produced with DeepSeek Harness. Use whenever creating a pull request or merge request. Also use when the user asks for a dsh badge, powered-by-dsh attribution, or a reusable dsh badge asset or snippet.",
          "invocation": {
            "modelInvocable": true,
            "userInvocable": true,
          },
          "name": "dsh-badge",
          "provider": "dsh-badge",
          "resourceBase": {
            "kind": "directory",
            "path": "{{badgeAssetsPath}}",
          },
          "source": "bundled",
        },
      }
    `)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS * 2)
})
