import { clientBundle } from '../../client/tsdown.client.ts'

/** 浏览器产物打包配置：以 Host 入口产物为外部依赖，输出由客户端加载器装载的模块工厂。 */
export default clientBundle('@deepseek-ai/dsh-qs-approval', ['lib/types/index.js'])
