/** Build-time values that bundlers replace before client code reaches a browser. */
/**
 * 文件职责：声明客户端源码在构建期可读取的受限 `process.env` 类型。
 * 技术维度：使用 TypeScript 模板字面量键，只开放 NODE_ENV 和 DSH_CLIENT_ 前缀。
 * 产品维度：客户端功能可按公开构建变量定制，同时避免误读任意服务器环境值。
 * 逻辑维度：声明全局 process 常量，并把允许的环境键收敛在只读 env 对象中。
 * 关键边界：这些值会进入公开浏览器构件，不能承载密钥或运行期私有配置。
 * 新手阅读建议：先看允许的键名，再到构建环境替换器理解值何时被写入。
 */
/** 构建期全局常量；只读且仅暴露下列公开环境变量，浏览器运行时不应修改。 */
declare const process: {
  readonly env: {
    /** 构建模式；通常是 development 或 production，未提供时可为 undefined。 */
    readonly NODE_ENV?: string
    /** 任意 DSH_CLIENT_ 前缀的公开构建变量；未配置的键返回 undefined。 */
    readonly [name: `DSH_CLIENT_${string}`]: string | undefined
  }
}
