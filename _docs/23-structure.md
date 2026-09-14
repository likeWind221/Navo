# 源码目录与命名整理方案

状态：源码目录与命名重构已实施，见 [实施记录](24-structure.md)。下文保留审查时的原路径映射；Command 功能范围收敛仍为独立后续事项。

## 扫描结论

扫描 src、rpc、frontend/src、frontend/electron 共 117 个 TypeScript/TSX/CSS 文件（含源码旁测试及 rpc 测试配置），其中 31 个文件名包含连字符；另外检查根 tests、scripts、前端 QA 脚本、构建入口、测试发现规则与静态导入关系。

主要集中点是 Qwen、Host、RPC 内容事件与桌面桥接。Agent、Session、Tools 和 Node 的现有顶层模块多数已经使用清晰单词，无需整体重命名。rpc/stream-rpc.ts 为 325 行，内部有独立 Client、Server 和队列状态，可按所有者拆分；Fetch network.ts 为 291 行且涉及地址校验、DNS/NAT64 和固定连接，本次保留其安全边界，不因行数机械拆开。

## 命名规则

1. 手写源码、测试及脚本的业务文件名不使用连字符组合词；用目录说明所属模块，用文件名说明角色。
2. 普通 TypeScript 文件用小写单词，如 types、validation、stream、process、request；React 组件文件用单词 PascalCase，如 Chat、Shell、List、Composer。
3. 模块顶层入口／契约保留在父目录，同名小写目录收纳其内部实现，例如 content.ts + content/、qwen.ts + qwen/、Chat.tsx + chat/。
4. 只有一个实现文件的模块不强制创建子目录；已内聚的 types/service/store/plugin/errors 等保留现状。目录不是为了给每个函数建一层。
5. 文件与导出符号分别管理：本轮优先保持函数、类型、React 组件及 RPC 方法的导出名称，避免把路径重构扩大为 API 改名；例如 List.tsx 可以继续导出 MessageList。
6. .spec.ts、.module.css、.d.ts 是工具约定的后缀，不算多词业务名称；electron.vite.config.ts、tsconfig.node.json 等配置文件保持工具识别名称。
7. 不新建只做 re-export 的目录 index.ts。rpc/index.ts 是已有包级公共出口，继续维护；src/index.ts 是实际程序入口，继续保留。
8. 本次针对源码命名；既有编号 Markdown 文档、第三方项目、依赖、历史 QA 产物和锁文件不统一重命名。CLAUDE.md 中仍举 session-service.ts 等例子，实施时同步改为目录限定命名，保留“文件角色要明确”的原则。

## 后端目标结构

```text
src/
├─ app.ts
├─ index.ts
├─ agent/                    现有 types/runtime/inbox/request/response/result/limits 保留
├─ brand/ids.ts
├─ session/                  现有 types/store 保留
├─ node/                     现有领域边界保留
│  ├─ session.ts             NodeSessionService，替代 session-service.ts
│  └─ ...                    model/events/store/projector/profile/tools/plugin/errors
├─ host/
│  ├─ main.ts                真实 Host 进程入口
│  ├─ config.ts
│  ├─ stdio.ts               服务端标准输入输出传输
│  ├─ turn.ts                Turn Handler
│  └─ turn/mock.ts           Mock Handler 与场景配置
├─ llm/
│  ├─ adapter.ts             公共适配接口，虽短但边界独立
│  ├─ adapters/
│  │  ├─ mock.ts
│  │  ├─ qwen.ts             Qwen 适配器入口
│  │  └─ qwen/
│  │     ├─ request.ts       请求序列化
│  │     └─ sse.ts           SSE 解析与增量翻译
│  └─ ...                    types/service/errors/assembler/collect 保留
└─ tools/
   ├─ ...                    types/service/schema/plugin/errors/testing 保留
   └─ builtins/
      ├─ file/               当前 types/errors 保留，不预建未来能力
      ├─ search/
      │  ├─ ...              types/tool/execution/validation/errors 保留
      │  └─ adapters/
      │     ├─ mock.ts
      │     ├─ exa.ts
      │     └─ exa/response.ts
      └─ fetch/
         ├─ http.ts
         ├─ http/response.ts  只由 HTTP 实现消费的响应读取
         ├─ output.ts
         ├─ output/
         │  ├─ html.ts
         │  └─ gfm.d.ts
         └─ ...              core/types/tool/validation/errors/policy/network/mock 保留
```

Fetch policy.ts 同时被请求校验和 HTTP 重定向使用，不放入 http/；network.ts 保持独立边界。tools/testing.ts 现为独立测试插件且未进入默认生产装配，本轮不额外改变其使用约定。上述判断来自导入关系，不仅是相同文件名前缀。

### 后端路径映射

| 当前路径 | 目标路径 |
|---|---|
| `src/host/kernel-host.ts` | `src/host/main.ts` |
| `src/host/agent-turn-handler.ts` | `src/host/turn.ts` |
| `src/host/mock-agent-turn.ts` | `src/host/turn/mock.ts` |
| `src/host/stdio-transport.ts` | `src/host/stdio.ts` |
| `src/llm/qwen-chat-adapter.ts` | `src/llm/adapters/qwen.ts` |
| `src/llm/qwen-sse.ts` | `src/llm/adapters/qwen/sse.ts` |
| `src/llm/qwen-wire.ts` | `src/llm/adapters/qwen/request.ts` |
| `src/llm/mock.ts` | `src/llm/adapters/mock.ts` |
| `src/node/session-service.ts` | `src/node/session.ts` |
| `src/tools/builtins/search/adapters/exa-response.ts` | `src/tools/builtins/search/adapters/exa/response.ts` |
| `src/tools/builtins/fetch/response.ts` | `src/tools/builtins/fetch/http/response.ts` |
| `src/tools/builtins/fetch/format.ts` | `src/tools/builtins/fetch/output.ts` |
| `src/tools/builtins/fetch/html.ts` | `src/tools/builtins/fetch/output/html.ts` |
| `src/tools/builtins/fetch/gfm.d.ts` | `src/tools/builtins/fetch/output/gfm.d.ts` |

## RPC 目标结构

```text
rpc/
├─ index.ts
├─ protocol.ts
├─ validation.ts
├─ errors.ts
├─ ndjson.ts
├─ stream.ts                 传输接口、流选项和 Handler 类型
├─ stream/
│  ├─ client.ts              Client 请求表与消费循环
│  ├─ server.ts              Server 活动任务与取消清理
│  ├─ router.ts              方法注册及查找
│  ├─ queue.ts               Client 内部队列对象边界
│  ├─ validation.ts          输出校验器创建
│  └─ tests/stream.spec.ts    传输生命周期测试
├─ agent.ts                  F2 兼容契约，暂不为目录对称拆分
├─ content.ts                助手事件类型与限制
├─ content/
│  ├─ validation.ts
│  ├─ stream.ts
│  └─ tests/content.spec.ts
├─ failure.ts                DisplayFailure 类型、限制及校验
├─ notification.ts           通知契约与当前校验，暂不机械拆开 43 行文件
├─ notification/
│  └─ tests/notification.spec.ts
└─ tests/
   ├─ protocol.spec.ts
   └─ integration.spec.ts    新旧业务方法接入 RPC 的测试
```

notification.ts 当前类型与校验紧密且很小，可以先保留为模块顶层实现文件；实际出现独立订阅状态机时，再在 notification/ 内增加相应文件。本次不预建 notification/stream.ts 或通知订阅功能。

### RPC 路径与拆分映射

| 当前路径 | 目标路径 |
|---|---|
| `rpc/content-validation.ts` | `rpc/content/validation.ts` |
| `rpc/content-stream.ts` | `rpc/content/stream.ts` |
| `rpc/tests/content.spec.ts` | `rpc/content/tests/content.spec.ts` |

| 当前内容 | 目标位置 | 拆分原则 |
|---|---|---|
| stream-rpc.ts 的传输接口、选项、Handler 类型 | stream.ts | 顶层公共契约 |
| StreamRpcClient | stream/client.ts | Client 自己拥有活动流及消费循环 |
| StreamRpcServer | stream/server.ts | Server 自己拥有 AbortController 与任务清理 |
| StreamRpcRouter、RegisteredMethod | stream/router.ts | 注册项类型由注册表模块拥有 |
| AsyncQueue | stream/queue.ts | Client 私有消费队列；Server 不额外依赖它 |
| createOutputValidator | stream/validation.ts | Client/Server 共用的已校验输入绑定 |
| failure 辅助函数 | stream/server.ts | 单一消费者，就地保留 |
| stream-rpc.spec.ts 的通用流测试及 Channel/transport fixture | stream/tests/stream.spec.ts 与 tests/helpers/transport.ts | 共享 fixture 仅供测试，不进入生产 |
| stream-rpc.spec.ts 的业务集成测试 | tests/integration.spec.ts | 跨模块验证独立保留 |
| content.ts 的 DisplayFailure 及 content-validation.ts 的 parseDisplayFailure | failure.ts | 同一个安全展示错误契约，解除通知对助手内容模块的依赖 |
| notification.ts 的公共通知测试 | notification/tests/notification.spec.ts | 从现有 command.spec.ts 提取通知相关断言，保留覆盖 |

上表路径相对 rpc/。stream/queue.ts 只被 Client 使用，按独立队列生命周期保留，不伪装为全局工具层；stream.ts 不转发子模块，包级出口从具体文件导出。

Command 范围单独处理：当前 command.ts、tests/command.spec.ts 和包级导出仍真实存在，但用户已要求先只做 Notification。源码改名阶段先保留它们并维持全部现有测试；下一次明确的范围收敛再移除命令入口与命令状态机，将通知测试迁入 notification/，调整集成断言与 F3 计划。不能把删除业务方法伪装成纯路径重构，也不能在删除命令后继续声称通知已有实际传输出口。上面的目标树表示范围收敛后的主结构；过渡期间额外保留 command.ts 和 tests/command.spec.ts。

## 前端目标结构

```text
frontend/
├─ shared/
│  ├─ agent.ts                DesktopAgentApi/输入输出类型
│  └─ agent/
│     ├─ validation.ts
│     ├─ errors.ts            IPC 可抛出错误
│     ├─ channels.ts          固定 IPC 通道
│     └─ tests/validation.spec.ts
├─ electron/
│  ├─ main.ts
│  ├─ preload.ts
│  ├─ preload/
│  │  ├─ agent.ts
│  │  └─ tests/agent.spec.ts
│  ├─ host/
│  │  ├─ process.ts
│  │  ├─ process/
│  │  │  ├─ stderr.ts
│  │  │  ├─ stdio.ts
│  │  │  └─ tests/stderr.spec.ts
│  │  ├─ launch.ts
│  │  └─ tests/               process.spec.ts、launch.spec.ts
│  └─ ipc/
│     ├─ agent.ts
│     └─ agent/
│        ├─ controller.ts
│        └─ tests/controller.spec.ts
├─ src/
│  ├─ App.tsx
│  ├─ main.tsx
│  ├─ env.d.ts
│  ├─ styles.css
│  ├─ styles/tokens.css
│  ├─ ui/Icon.tsx
│  ├─ preview/                Sample.tsx、Sample.module.css
│  └─ workspace/
│     ├─ Shell.tsx
│     ├─ Chat.tsx
│     ├─ style.module.css     当前四个组件共享的 CSS，先保持原作用域
│     └─ chat/
│        ├─ Composer.tsx
│        ├─ List.tsx
│        ├─ conversation.ts   会话类型和纯 reducer
│        ├─ conversation/
│        │  ├─ hook.ts        React 订阅、互斥与清理
│        │  └─ tests/state.spec.ts
│        └─ tests/           Composer.spec.tsx、List.spec.tsx
└─ scripts/qa/                static.cjs、chat.ts
```

当前 Main、Preload 和 Renderer 都依赖 src/agent/desktop-agent-contract.ts，因此它是跨进程的桌面共享契约，应迁到 shared/，不继续伪装成 Renderer 内部模块。shared/ 仅依赖公共 rpc 和浏览器可用基础类型，禁止导入 Electron、Node 或后端私有实现。现有 DesktopAgentCommandError 表示 IPC 调用拒绝，不是斜杠命令实现；不能因为暂缓 Command 功能就把它删除。

将 contract 拆为 shared/agent.ts（公开类型）、shared/agent/validation.ts（字段校验）和 shared/agent/errors.ts（可抛出错误），是按跨进程契约与错误职责拆分；不是每个函数一个文件。Renderer env.d.ts 和 Main/Preload 的导入同步更新。

### 前端路径映射

| 当前路径 | 目标路径 |
|---|---|
| `frontend/electron/preload-agent-api.ts` | `frontend/electron/preload/agent.ts` |
| `frontend/electron/preload-agent-api.spec.ts` | `frontend/electron/preload/tests/agent.spec.ts` |
| `frontend/electron/host/kernel-host-process.ts` | `frontend/electron/host/process.ts` |
| `frontend/electron/host/kernel-host-process.spec.ts` | `frontend/electron/host/tests/process.spec.ts` |
| `frontend/electron/host/host-stderr-monitor.ts` | `frontend/electron/host/process/stderr.ts` |
| `frontend/electron/host/host-stderr-monitor.spec.ts` | `frontend/electron/host/process/tests/stderr.spec.ts` |
| `frontend/electron/host/stdio-client-transport.ts` | `frontend/electron/host/process/stdio.ts` |
| `frontend/electron/host/launch-config.ts` | `frontend/electron/host/launch.ts` |
| `frontend/electron/host/launch-config.spec.ts` | `frontend/electron/host/tests/launch.spec.ts` |
| `frontend/electron/ipc/agent-turn-ipc.ts` | `frontend/electron/ipc/agent.ts` |
| `frontend/electron/ipc/agent-turn-controller.ts` | `frontend/electron/ipc/agent/controller.ts` |
| `frontend/electron/ipc/agent-turn-controller.spec.ts` | `frontend/electron/ipc/agent/tests/controller.spec.ts` |
| `frontend/electron/ipc/agent-turn-channels.ts` | `frontend/shared/agent/channels.ts` |
| `frontend/src/agent/desktop-agent-contract.spec.ts` | `frontend/shared/agent/tests/validation.spec.ts` |
| `frontend/src/workspace/WorkspaceShell.tsx` | `frontend/src/workspace/Shell.tsx` |
| `frontend/src/workspace/ChatWorkspace.tsx` | `frontend/src/workspace/Chat.tsx` |
| `frontend/src/workspace/Composer.tsx` | `frontend/src/workspace/chat/Composer.tsx` |
| `frontend/src/workspace/Composer.spec.tsx` | `frontend/src/workspace/chat/tests/Composer.spec.tsx` |
| `frontend/src/workspace/MessageList.tsx` | `frontend/src/workspace/chat/List.tsx` |
| `frontend/src/workspace/MessageList.spec.tsx` | `frontend/src/workspace/chat/tests/List.spec.tsx` |
| `frontend/src/workspace/conversation-state.ts` | `frontend/src/workspace/chat/conversation.ts` |
| `frontend/src/workspace/conversation-state.spec.ts` | `frontend/src/workspace/chat/conversation/tests/state.spec.ts` |
| `frontend/src/workspace/use-agent-conversation.ts` | `frontend/src/workspace/chat/conversation/hook.ts` |
| `frontend/src/workspace/Workspace.module.css` | `frontend/src/workspace/style.module.css` |
| `frontend/src/preview/DesignSample.tsx` | `frontend/src/preview/Sample.tsx` |
| `frontend/src/preview/DesignSample.module.css` | `frontend/src/preview/Sample.module.css` |

额外拆分：`frontend/src/agent/desktop-agent-contract.ts` → `frontend/shared/agent.ts`、`frontend/shared/agent/validation.ts`、`frontend/shared/agent/errors.ts`。原文件所有导出按职责迁移，函数行为和名称保留。原 src/agent/ 空目录在确认无其他文件后移除。

样式只改路径与引用：当前 Workspace.module.css 同时服务 Shell、Chat、Composer、MessageList，而且包含共用断点和动效，本轮不拆 CSS 规则、不改视觉。开发预览 App.tsx 的动态 import 也要更新，生产默认入口和预览隔离保持不变。

## 根测试与脚本

后端测试仍集中在根 tests/，目录镜像模块职责；不将当前生产编译面扩大为测试与 fixture 混放。前端保持源码旁测试，RPC 采用模块内测试加顶层跨模块集成测试。既有独立包测试命令保持不变，不要求跨工程统一物理根目录。

### 后端测试映射

| 当前路径 | 目标路径 |
|---|---|
| `tests/cancellation.spec.ts` | `tests/agent/cancellation.spec.ts` |
| `tests/runtime.spec.ts` | `tests/agent/runtime.spec.ts` |
| `tests/resilience.spec.ts` | `tests/agent/resilience.spec.ts` |
| `tests/limits.spec.ts` | `tests/agent/limits.spec.ts` |
| `tests/collect.spec.ts` | `tests/llm/collect.spec.ts` |
| `tests/llm.spec.ts` | `tests/llm/service.spec.ts` |
| `tests/streaming.spec.ts` | `tests/llm/streaming.spec.ts` |
| `tests/errors.spec.ts` | `tests/llm/errors.spec.ts` |
| `tests/qwen-chat-adapter.spec.ts` | `tests/llm/adapters/qwen.spec.ts` |
| `tests/session.spec.ts` | `tests/session/store.spec.ts` |
| `tests/messages.spec.ts` | `tests/session/messages.spec.ts` |
| `tests/node.spec.ts` | `tests/node/session.spec.ts` |
| `tests/node-store.spec.ts` | `tests/node/store.spec.ts` |
| `tests/node-content.spec.ts` | `tests/node/content.spec.ts` |
| `tests/node-research-integration.spec.ts` | `tests/integration/research.spec.ts` |
| `tests/node-learning-integration.spec.ts` | `tests/integration/learning.spec.ts` |
| `tests/integration.spec.ts` | `tests/integration/app.spec.ts` |
| `tests/kernel-host.spec.ts` | `tests/host/turn.spec.ts` |
| `tests/host-process.spec.ts` | `tests/host/process.spec.ts` |
| `tests/tools.spec.ts` | `tests/tools/service.spec.ts` |
| `tests/search-tool.spec.ts` | `tests/tools/search/tool.spec.ts` |
| `tests/search-execution.spec.ts` | `tests/tools/search/execution.spec.ts` |
| `tests/search-exa.spec.ts` | `tests/tools/search/adapters/exa.spec.ts` |
| `tests/fetch-tool.spec.ts` | `tests/tools/fetch/tool.spec.ts` |
| `tests/fetch-network.spec.ts` | `tests/tools/fetch/network.spec.ts` |
| `tests/fetch-http.spec.ts` | `tests/tools/fetch/http.spec.ts` |
| `tests/fetch-core.spec.ts` | `tests/tools/fetch/core.spec.ts` |
| `tests/protocol.spec.ts` | `tests/protocol/core.spec.ts` |
| `tests/protocol.typecheck.ts` | `tests/protocol/core.typecheck.ts` |

`tests/helpers/{llm,runtime,tools}.ts` 是跨场景测试装配，路径保留，更新其生产依赖。上述表按当前导入归属整理，例如 errors.spec.ts 实际验证 LLM 错误，应归入 llm/；不是只根据文件名猜测模块。

### 脚本映射

| 当前路径 | 目标路径 |
|---|---|
| `scripts/mock-kernel-host.ts` | `scripts/host/mock.ts` |
| `scripts/search-smoke.ts` | `scripts/search/smoke.ts` |
| `scripts/fetch-smoke.ts` | `scripts/fetch/smoke.ts` |
| `frontend/scripts/f1-2-3-qa.cjs` | `frontend/scripts/qa/static.cjs` |
| `frontend/scripts/f2-6-qa.ts` | `frontend/scripts/qa/chat.ts` |

`scripts/real.ts` 保留。前端 QA 构建入口名从 f2-6-qa 改为 chat，对应产物 out/main/chat.js；现有 npm script 键 qa:f2-6 可暂时保留作为调用入口，只更新目标路径，避免同时改变操作习惯。QA 历史输出文件和 qa-output 目录不迁移，脚本工作目录语义保持不变。

## 必须同步修改的引用与配置

- 所有静态／动态 import、type import、公共导出、vi.mock 路径和测试 fixture 引用。
- 根 package.json 的 host/host:mock 入口；scripts 内 CLI 使用提示、测试中 spawn 的 Host 路径。
- frontend/electron/host 的启动配置含仓库根推导和脚本路径，移动后重新验证，不能只做字符串替换。
- frontend/electron.vite.config.ts 的 QA 源入口和产物名；frontend/package.json 的 QA 目标；正常 main/preload 输出路径不变。
- rpc/vitest.config.ts 当前只发现 rpc/tests/**/*.spec.ts，需加 rpc/content/tests、rpc/stream/tests、rpc/notification/tests 等实际模块测试（或等价且排除依赖目录的规则）。
- frontend/vitest.config.ts 增加 shared/**/*.spec.ts；node/web tsconfig 均明确纳入 shared/**/*.ts，测试文件沿用当前类型检查策略；不能只靠被生产 import 间接纳入而漏掉独立测试。
- 根 vitest.config.ts 已包含 tests/**/*.spec.ts，无需为测试目录加深修改规则；rpc/tsconfig.json 与根 tsconfig 现有递归范围能够覆盖各自目录内迁移。
- 前后端计划、模块架构记录、开发进度和当前可执行示例同步更新；历史 devlog 的历史路径可注明迁移映射，避免把历史事实改成当前实现。
- 文件改名不需要改包依赖或更新 pnpm-lock.yaml，也不改变 wire method、IPC channel 字符串或类名。

## 实施顺序与验收

1. 先落实本命名约定到 CLAUDE.md；按当前未提交修改做清单，识别并保留其他会话工作。共享 rpc、索引及跨端改动由本次重构唯一执行者串行处理。
2. 后端纯路径迁移：Qwen、Host、NodeSession、Exa、Fetch 私有子模块；同步根脚本、测试路径与前端 Host 启动引用，确保每个批次可运行。
3. RPC 目录整理：content 迁移、共享 failure 解耦、stream 按状态所有者拆分；同步后端与前端消费者，维持 F2/F3.1 原方法行为。
4. 前端共享契约归位，再整理 Preload、IPC、Host 和工作区组件；同步动态导入、样式及 QA 入口。
5. 收拢测试和脚本，完成跨端检查；最后单独推进 Notification 优先的功能范围调整，新增通知实际出口仍须另一个明确步骤。

每批完成后扫描旧路径残留、目标文件名连字符、同名冲突与循环依赖。执行对应包类型检查和测试；跨端收口执行根 typecheck/test、RPC typecheck/test、前端 typecheck/test/build，并确认前后测试发现数量和断言覆盖未因迁移减少。Notification 功能收敛导致的测试删除必须单独说明，不能用数量下降掩盖漏跑。

涉及进程路径的批次做 Mock Host 启停、取消、stderr、窗口关闭检查；前端最后做 Electron 冒烟验证，包括正常入口与开发预览、发送／停止、滚动和窄屏。避免 Electron 开发进程运行时覆盖其 out 构建目录。

## 方案形成时的检查（历史记录）

只完成源码清单、静态依赖与入口配置检查，以及本方案。映射已检查源文件存在、目标不冲突、目标文件名无连字符，并确认扫描范围内全部 31 个含连字符文件已纳入移动或拆分方案。没有修改源码、运行测试、改变 F3.1 完成状态或把本方案标为已实施。
