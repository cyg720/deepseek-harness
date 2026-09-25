# M0 隔离机制验证

[English](README.md) | 中文

这里保存基于真实槽内核和注册表的开发验证源码，不属于静态界面原型，也不等于完整 QS 插件验收。

在仓库根目录运行：

```powershell
node node_modules/vitest/vitest.mjs run --config qishu/tests/m0/m0.config.ts
node node_modules/typescript/bin/tsc -p qishu/tests/m0/tsconfig.m0.json
```

运行测试使用源码别名；类型检查通过项目引用使用依赖声明，需先构建依赖。测试源码和配置进入 Git，原始运行 JSON、日志及覆盖率页面保留本地，人工结论记录在 `qishu/PRD/1-AI工作台/复核测试`。
