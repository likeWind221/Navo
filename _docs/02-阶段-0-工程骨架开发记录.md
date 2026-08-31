# 阶段 0 开发记录：TypeScript 与 Cordis 工程骨架

## 做了什么

完成 SkillWorld 内层 AgentLoop 的工程基础：

1. 创建 `package.json`，建立私有 ESM 项目并锁定 Node.js 24、pnpm、TypeScript、Vitest、tsx 和 Cordis。
2. 创建 `tsconfig.json`，开启严格类型检查，同时检查 `src/` 与 `tests/`。
3. 生成 `pnpm-lock.yaml`，安装精确版本依赖并显式授权 esbuild 安装脚本。
4. 创建 `src/index.ts`，验证 Cordis 根 Context 可以启动、释放并在异常时设置失败退出码。

## 关键决策

- 运行时要求 Node.js `>=24.0.0`，Node 类型固定为 `@types/node@24.13.3`。
- 使用上游 `cordis@4.0.0-rc.9`，不依赖 DeepSeek 的 Cordis fork，也暂不 vendor 源码。
- `target` 和 `lib` 固定为 ES2024；模块输出使用 ESNext。
- 使用 Bundler 模块解析兼容上游 Cordis 的扩展名省略声明；项目自身相对导入仍约定使用 `.js`。
- 当前 `noEmit`，由 `tsx` 执行源码；正式产物构建留待需要时增加独立配置。
- `node_modules/` 与未来的 `dist/` 均不进入版本库。

## 坑与发现

- 上游 Cordis 的 latest 仍是 4.0 RC，因此通过精确版本和 Lockfile 防止自动漂移。
- pnpm 默认阻止 esbuild 安装脚本；使用 `pnpm.onlyBuiltDependencies` 显式授权后，tsx 与 Vitest 均可正常启动。
- 上游 Cordis 声明文件省略内部相对路径扩展名，严格 NodeNext 无法解析其导出；Bundler 解析可以在不维护 fork 的情况下通过类型检查。
- `build` 当前受 `noEmit` 约束，实质上只进行类型检查；需要发布产物时再设计 `tsconfig.build.json`。

## 验收结果

```text
pnpm typecheck  通过
pnpm dev        通过
Node.js         v24.14.0
TypeScript      7.0.2
Cordis          4.0.0-rc.9
忽略构建脚本    无
```

## 下一步

进入阶段 1，从 `src/brand/ids.ts` 开始定义提供商无关的品牌化 ID。
