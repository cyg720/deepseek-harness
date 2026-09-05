import { defineConfig } from 'tsdown'

/**
 * Node-only backend. The Win32 dialog worker builds as its own CJS entry
 * (mirroring dsh-workflow-worker-thread's worker): path-loaded by the driver,
 * inlining the dialog logic while koffi stays an external native require.
 */
/*
 * 文件职责：分别构建原生目录选择后端 ESM 入口和 Windows 对话框 CommonJS Worker。
 * 技术维度：使用 tsdown 多配置、命名入口和外部原生依赖，兼容 pkg 虚拟文件系统加载。
 * 产品维度：让桌面宿主使用系统原生目录选择器，并能在打包可执行程序中正常弹窗。
 * 逻辑维度：第一项构建 index 与 invariant；第二项把描述性源码入口命名输出为 worker.cjs。
 * 关键边界：Worker 必须保持 CommonJS 且 koffi 不能内联；产物名是包 exports 与运行时加载约定。
 * 新手阅读建议：先看第二项 entry 的键值含义，再对照 package.json 的 ./worker 导出。
 */
export default defineConfig([
  // 主入口：输出目录选择服务实现与不变量伴生模块的 Node ESM。
  {
    entry: ['lib/types/index.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  // Worker 入口：输出路径加载的 Windows 原生对话框 CommonJS 脚本。
  {
    // The artifact is lib/worker.cjs (the ./worker export the workspace
    // constraint keys on), bundled from the descriptive source entry.
    // 产物固定为 lib/worker.cjs（工作区约束检查的 ./worker 导出），源码仍使用可读的描述性名称。
    entry: { worker: 'lib/types/win32-dialog-worker.js' },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
])
