/**
 * @deepseek-ai/dsh-base — the shared dsh core as a profile bundle. The
 * package's substance is `cordis.patch.yml`, declared by the `dsh.bundle.patch`
 * manifest field and resolved by the profile composer through that field;
 * this module carries no runtime API.
 * @module @deepseek-ai/dsh-base
 */
/*
 * 文件职责：作为基础配置包的空运行时入口，实际内容由 `cordis.patch.yml` 提供。
 * 技术维度：使用空 ESM 导出维持 npm 包入口，配置加载由 Cordis profile composer 完成。
 * 产品维度：所有 profile 都能从同一组模型、工具、存储与策略插件开始组合。
 * 逻辑维度：包清单指向补丁文件，本模块只证明存在可导入的运行时入口。
 * 关键边界：不要在此加入运行逻辑；基础插件行必须继续由可覆盖的配置补丁拥有。
 * 新手阅读建议：跳过空导出，直接阅读本包的 package.json 与 cordis.patch.yml。
 */

/* 空导出把文件标记为 ESM 模块；不提供任何运行时值。 */
export {}
