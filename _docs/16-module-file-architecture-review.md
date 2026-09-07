# 模块分文件架构审核

**审核基线：** 当前目录重构后的工作区。  
**范围：** src、rpc、frontend/src、frontend/shared、frontend/electron；不含第三方依赖与构建产物。

## 1. 当前结论

采用用户确认的“目录表达归属、单词文件名表达职责”。模块顶层契约或入口与同名子目录配合；现有领域、状态、安全边界不因行数机械合并。完整原路径映射见 [目录整理方案](24-structure.md)。

## 2. 模块分工

| 模块 | 当前结构与保留理由 |
|---|---|
| src/brand | ids.ts 内聚管理标识，不按 ID 类型拆分 |
| src/session | types.ts 负责事件协议，store.ts 负责事实提交与投影 |
| src/agent | runtime/inbox/request/response/result/limits 保留各自流程与状态职责 |
| src/llm | 公共 adapter/types/service 与 assembler/collect 分离；adapters/qwen.ts 组合 qwen/request.ts 与 qwen/sse.ts，Mock 独立 |
| src/host | main.ts 进程入口，config.ts 配置，stdio.ts 传输，turn.ts 处理业务，turn/mock.ts 提供测试场景 |
| src/node | model/events/projector/store/profile/tools/plugin 保持领域边界；session.ts 拥有 NodeSession 服务 |
| src/tools | schema.ts 与 service.ts 分别负责参数边界和注册执行，plugin.ts 为组合根；testing.ts 不进入默认生产装配 |
| search | 安全校验、执行和 Adapter 分层保留；Exa 响应读取归入 adapters/exa/response.ts |
| fetch | http.ts 组合 http/response.ts；output.ts 组合 output/html.ts；policy.ts 仍由 Core 校验与 HTTP 共用，network.ts 保留 DNS/NAT64/固定连接安全边界 |
| file | types.ts 管理文件 Schema、请求／结果与预算；errors.ts 管理局部可抛错误，尚未引入 IO 实现 |
| rpc/stream | stream.ts 为公共类型；client/server/router/queue/validation 各有所有者，Client 持有队列，Server 持有活动任务与取消器 |
| rpc/content | content.ts 定义事件，content/validation.ts 校验字段，content/stream.ts 管理事件顺序与身份 |
| rpc/failure | failure.ts 管理可展示错误类型和校验；与 errors.ts 可抛异常分开，Notification 不依赖助手模块 |
| frontend/shared | agent.ts 为浏览器安全公共类型，agent/validation、errors、channels 为契约支撑；三端直接引用，不依赖 Renderer 内部模块 |
| frontend/electron | main/preload 保留安全入口；preload/agent、ipc/agent/controller、host/process 各自拥有桥接／活动请求／子进程状态 |
| frontend/src/workspace | Shell/Chat 为入口；chat 下的 Composer/List 与 conversation reducer/Hook 分工明确，style.module.css 保留共用布局和断点 |

## 3. 文件粒度复核

rpc 原聚合文件已按独立生命周期拆分；新的 stream.ts、stream/validation.ts、shared/agent/errors.ts 即使较短也代表稳定协议或错误边界，不通过转发层凑目录。Fetch network.ts 与 Tools schema/service 仍接近 250–300 行，分别承担安全校验与注册执行职责，本轮不混入算法重构。没有新增只做 re-export 的目录 index.ts；仅维护既有 rpc/index.ts 包级出口。

## 4. 测试与后续边界

根 tests 按领域组织，RPC 采用模块内测试与独立集成测试，前端 shared 测试纳入 Vitest 和两套 TypeScript 配置。现有命令契约本次保持兼容；Notification 优先的功能收敛应另行记录，不能把删除方法混进纯结构修改。持久化、重连、通用订阅和新 UI 都未因目录重构提前实现。

验证结果与实际迁移细节见 [实施记录](25-structure.md)。
