# Step 6.9.8 Node 模块归并与命名统一

## 做了什么

- 将 `src/learning/{types,events,content,errors,projector}.ts` 原位职责迁入 `src/node/`，`learning/service.ts` 迁为 `node/store.ts`，删除空 learning 目录。
- 统一 LearningStore → NodeStore、LearningError/Code → NodeError/Code、ctx.learning → ctx.nodes；Cordis 服务键与依赖注入改为 nodes，内部观察者通知改为 node/event，日志分类为 node。
- 更新 `src/node/tools.ts` 的同目录导入与授权存储引用；`tests/learning.spec.ts` 改为 `tests/node-store.spec.ts`，同步 node-content 测试。
- 后端计划当前路径与未来组合使用新名称；历史开发记录保留原路径以保留历史。本次串行登记 32 号开发记录和索引，不修改前端。

## 关键决策

- 同属 Node 的领域协议、存储和工具集中在一个目录，但仍按职责拆文件；store.ts 保存领域事实，未来 service.ts 才负责 NodeSession 编排，不创建占位文件。
- 这是内部命名/路径迁移，不保留旧类、服务键、通知名或导入路径的兼容别名；错误码、领域事件 type/data、revision、冻结、参考答案脱敏、Session 授权和取消行为不变。依赖旧 Error.name 或 Cordis 通知名的内部调用方需同步，现有调用方已迁移。
- Harness 没有本项目的学习 NodeStore 对应模块；只读检查 `packages/core/session/src/index.ts` 的 SessionStore，参考其 ctx.sessions 与 session/event 的集合服务/单体通知命名习惯，采用 ctx.nodes 与 node/event。没有将 Node 事实合并进 Harness 风格的 Session 日志，也没有引入其 create fiber 所有权、typert 或持久化插件机制。
- 迁移不改变函数算法；content/types/events 仅移动，projector 仅更换错误类引用；本次不借重构修复其他行为或扩大功能。

## 坑与发现

- 除类名外，必须同时迁移 Context 增强、super 服务名、工具 inject、通知订阅和日志分类，否则可能编译通过但插件不激活或监听失效。
- store.ts 命名避免占用后续 NodeSession service.ts；现有测试文件名也区分存储与未来会话编排。
- `pnpm typecheck` 与 `pnpm test` 通过，15 文件/110 测试全部通过；覆盖领域重建、版本、跨 Node 授权、冻结、观察者异常隔离和服务生命周期。
- 源码/测试/脚本全量扫描无旧 LearningStore、LearningError、ctx.learning、learning/ 引用；未改动默认应用或进行网络请求。

## 下一步

- 审查后进入 6.10.1 Search Service 行为测试，后续再做 NodeAgent Profile 与 NodeSession 编排。
