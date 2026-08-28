/**
 * The /api URL prefix — single source for both halves of the web transport.
 * The node half registers this prefix on the web server.
 */
/*
 * 文件职责：集中定义 Web 传输两端共同使用的 API 与 WebSocket 路径。
 * 技术维度：使用 TypeScript 字符串常量和模板字符串派生子路径。
 * 产品维度：浏览器请求与主机路由使用同一地址，避免连接端点漂移。
 * 逻辑维度：先声明 `/api` 根前缀，再派生 mux 事件与 host 事件路径。
 * 关键边界：修改任一路径必须同步影响主机注册和浏览器连接，不提供兼容别名。
 * 新手阅读建议：先看根前缀，再分别搜索两个 WebSocket 常量的生产与消费位置。
 */

/** Route prefix owning every api request (`/api` and `/api/<anything>`). */
/* 所有 API 请求的固定根前缀；覆盖 `/api` 本身及其全部子路径。 */
export const API_PATH = '/api'
