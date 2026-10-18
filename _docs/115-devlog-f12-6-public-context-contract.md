# F12.6 压缩与上下文压力公共契约

> 日期：2026-10-17  
> 状态：✅ 生产实现完成，本机五条验证与 Electron Bridge 实际调用验收通过；PR [#78](https://github.com/likeWind221/Navo/pull/78) head CI 通过并已 squash 合入 master（3bf5e10）。  
> 基线：master 3c464f5c54abb80829f2f34b41e35dbcf084b09d（F12.5 已合入）。  
> 范围：Host / RPC / Electron Bridge 的稳定公共接口；不开发上下文 UI，不修改压缩算法。

## 1. 目标与边界

F12.1–F12.5 已具备 Context Meter、自动压力压缩、摘要检查点、超窗恢复、事务重启对账与 Human 主动 /compact。目前调用方能通过命令摘要知道一次手动压缩的结果，但不能稳定地查询任意 Session 当前上下文状态、持续观察压缩生命周期，也不能通过公共历史接口明确识别摘要检查点。

F12.6 将这些内部能力收敛为三个版本化接口：

1. session.context.v1：读取一次当前 Session 的上下文快照。
2. session.context.follow.v1：订阅上下文变化和压缩生命周期事件。
3. session.history.v1：分页读取当前有效历史，并将摘要检查点标记为独立类型。

核心原则：

- 公共契约复用现有请求构建、上下文测量、预算计算和 Session surface；不复制一套计算逻辑。
- 查询和订阅只观察状态，不主动调用模型、不触发压缩、不修改历史。
- 历史接口返回当前模型可见的有效历史，而非完整内部事件日志。
- Electron Bridge 只暴露经过校验的 DTO 和明确的取消能力；Renderer 不得依赖 src/**、Cordis Context 或内部 Store。
- 本 Step 不实现上下文用量面板、压缩动画或其他 UI；前端页面继续按 frontend-plan.md 单独规划。

## 2. 主流程

~~~text
Caller / Desktop
      |
      +---- session.context.v1 ---------> Context Snapshot
      |
      +---- session.context.follow.v1 --> Initial Snapshot
      |                                      |
      |                                      v
      |                              Session Event Observer
      |                               /                \
      |                              v                  v
      |                       Context Update       Compaction Event
      |                              \                  /
      |                               v                v
      |                              Desktop Bridge
      |
      +---- session.history.v1 -------> Effective History Page
                                           |
                                           v
                               Message / Summary Checkpoint
~~~

新增 / 修改区段：RPC DTO 与 validator、Host 查询和订阅处理、Electron IPC / preload / shared API 与验证。复用区段：SessionStore、SessionContextResolver、createGenerateRequest、measureContext、resolveContextBudget、现有 Stream RPC、Electron Host 生命周期和 Session 压缩事务。

## 3. 当前代码基础

- src/session/store.ts：getEvents()、getSurfaceSnapshot() 与 deriveMessages() 是历史日志、有效 surface 和模型可见消息的权威来源；session/event 在事件提交后发布。
- src/session/surface.ts：compaction-checkpoint 通过 surfaceOp: replace 替换被压缩前缀，generation 在 replace 时递增。
- src/context/meter.ts、src/context/budget.ts、src/context/pressure.ts：已有上下文测量、预算解析和压力判定。
- src/agent/request.ts：createGenerateRequest() 构造与真实请求相同的模型、消息、工具和采样参数；查询只能构造请求，不得调用 LLM。
- src/command/context.ts：F12.5 引入的 SessionContextResolver 能解析 Main / Node / 普通 Session 当前模型上下文。F12.6 应复用它，不得另写近似版本；若模块归属妨碍复用，可做不改变行为的最小移动 / 提取，使它成为 Session 级能力。
- src/host/project/follow.ts、src/host/project.ts：可参考当前 Stream RPC、StreamEventQueue、初始快照、取消和资源清理模式。
- frontend/electron/ipc/session.ts、frontend/electron/preload/agent.ts：已有 Agent / Command IPC 模式；F12.6 应新增独立 Session Context 通道，不把查询与订阅塞进现有 Agent Turn 事件语义。

## 4. 公共 API 契约

### 4.1 session.context.v1

输入：

~~~ts
interface SessionContextInputV1 {
  readonly sessionId: string;
}
~~~

输出：

~~~ts
interface SessionContextSnapshotV1 {
  readonly sessionId: string;
  readonly eventSequence: number;
  readonly surfaceGeneration: number;
  readonly measuredAt: string;
  readonly measurement: {
    readonly usedTokens: number;
    readonly estimatedRequestTokens: number;
    readonly basis: "usage" | "estimate";
  };
  readonly budget:
    | {
        readonly kind: "enabled";
        readonly contextWindow?: number;
        readonly reservedOutputTokens: number;
        readonly thresholdTokens: number;
        readonly retainTokens: number;
        readonly exceeded: boolean;
      }
    | {
        readonly kind: "disabled";
        readonly reason: "missing-capacity" | "no-pressure-budget";
      };
}
~~~

语义与约束：

- eventSequence 是本次快照已包含的 Session 事件日志高水位；空历史为 0。
- surfaceGeneration 来自 SessionStore.getSurfaceSnapshot()。追加消息不改变它，历史前缀被检查点替换时递增。
- measurement 使用现有 createGenerateRequest() 和 measureContext()；basis 保留 Meter 的真实口径。数值是现有 Meter 的测量 / 估算，不承诺精确 tokenizer 计数。
- budget.kind === "disabled" 不代表测量不可用；它表示自动压缩预算无法启用。不要在公共 API 再实现 90% 阈值或保留预算公式。
- contextWindow 可能缺失：现有配置允许仅设置 autoCompactLimit 的预算模式。
- measuredAt 使用 ISO 时间戳。DTO 不返回 system prompt、工具 schema、密钥或原始内部事件。
- 该接口是只读查询：不调用 LLM、不 append 事件、不启动 Turn、不触发压缩。

### 4.2 session.context.follow.v1

输入：

~~~ts
interface SessionContextFollowInputV1 {
  readonly sessionId: string;
}
~~~

输出为 Stream RPC 多帧联合类型，必须严格校验：

~~~ts
type SessionContextFollowEventV1 =
  | {
      readonly type: "snapshot";
      readonly snapshot: SessionContextSnapshotV1;
    }
  | {
      readonly type: "context-updated";
      readonly snapshot: SessionContextSnapshotV1;
    }
  | {
      readonly type: "compaction-event";
      readonly event: SessionCompactionEventV1;
    };
~~~

SessionCompactionEventV1 使用公开 DTO，而不是直接透传 SessionEvent：

~~~ts
type SessionCompactionEventV1 =
  | {
      readonly kind: "started";
      readonly sessionId: string;
      readonly sequence: number;
      readonly timestamp: string;
      readonly compactionId: string;
      readonly trigger: "pressure" | "overflow" | "manual";
      readonly coveredStart: number;
      readonly coveredEnd: number;
      readonly turnId?: string;
    }
  | {
      readonly kind: "checkpoint";
      readonly sessionId: string;
      readonly sequence: number;
      readonly timestamp: string;
      readonly compactionId: string;
      readonly coveredStart: number;
      readonly coveredEnd: number;
      readonly summaryVersion: 1;
      readonly surfaceGeneration: number;
    }
  | {
      readonly kind: "ended";
      readonly sessionId: string;
      readonly sequence: number;
      readonly timestamp: string;
      readonly compactionId: string;
      readonly status: "completed" | "failed" | "cancelled" | "interrupted";
      readonly beforeTokens?: number;
      readonly afterTokens?: number;
      readonly summaryTokens?: number;
      readonly provider?: string;
      readonly model?: string;
      readonly failure?: { readonly code: string; readonly message: string };
    };
~~~

订阅语义：

1. Host 先注册 session/event 监听，再读取初始快照；首帧必须是 snapshot，确保调用方无需在“先查再订阅”的窗口中承担漏事件风险。
2. 订阅只处理输入中的 sessionId。事件按 Session sequence 排序、去重；内部先处理完整连续事件序列，再发出对应状态快照，避免 Cordis 异步观察造成重复或乱序。首帧 snapshot 的 eventSequence 是订阅线性化点：该高水位以内的事件视为初始基线，不回放；若订阅恰在压缩中途建立，后续可能只收到 checkpoint / ended，调用方不得假设每个 ended 都配有当前订阅内的 started。
3. 用户消息、带内容的 Assistant 消息、工具结果和检查点改变模型可见 surface 后，发送 context-updated。压缩 started / checkpoint / ended 均发送 compaction-event；checkpoint 同时触发新的上下文快照。
4. compaction-event 不携带摘要正文或原始 SessionEvent。摘要正文只通过 session.history.v1 的检查点条目读取。
5. 订阅基线 eventSequence 之前的事件忽略；取消、RPC stream abort、Renderer 销毁或 Host 关闭时必须移除监听并结束队列。
6. 订阅仅跟随 Session 事件。若 Project / Profile 的模型配置在没有 Session 事件时被外部修改，调用方应重新查询；本 Step 不新增 Project 配置观察系统。
7. 首帧缺失时输出校验失败。运行时无法重新构建上下文时按 RPC 错误终止该订阅，不静默返回伪造的空快照。

### 4.3 session.history.v1

输入：

~~~ts
interface SessionHistoryInputV1 {
  readonly sessionId: string;
  readonly limit: number;
  readonly cursor?: {
    readonly surfaceGeneration: number;
    readonly offset: number;
  };
}
~~~

输出：

~~~ts
type SessionHistoryEntryV1 =
  | {
      readonly kind: "message";
      readonly sequence: number;
      readonly timestamp: string;
      readonly message: SessionHistoryMessageV1;
    }
  | {
      readonly kind: "summary-checkpoint";
      readonly sequence: number;
      readonly timestamp: string;
      readonly message: SessionHistoryMessageV1;
      readonly compactionId: string;
      readonly coveredStart: number;
      readonly coveredEnd: number;
      readonly summaryVersion: 1;
    };

interface SessionHistoryV1 {
  readonly sessionId: string;
  readonly surfaceGeneration: number;
  readonly entries: readonly SessionHistoryEntryV1[];
  readonly nextCursor: {
    readonly surfaceGeneration: number;
    readonly offset: number;
  } | null;
}
~~~

其中 SessionHistoryMessageV1 复用现有 RPC 已公开的消息 / 内容块结构，不得从 src/llm/** 暴露私有类型。输入 limit 为 1..50 的安全整数；cursor.offset 为非负安全整数。

历史语义：

- 只返回 SessionStore.getSurfaceSnapshot() 当前有效 surface 中实际贡献给模型上下文的消息；不返回完整事件日志，也不返回已被后续压缩检查点替换的旧消息。
- 普通 user / assistant / tool-result 内容使用 kind: "message"；compaction-checkpoint 使用 kind: "summary-checkpoint"，附带压缩事务 ID、覆盖范围和摘要版本。不得把检查点伪装成 Human 的普通 user message。
- sequence 是该条记录在 Session 事件日志中的原始序号，不是页内索引。
- 第一页不传 cursor，视为当前 surfaceGeneration 下的 offset 0。后续请求必须带回 nextCursor。
- 若 cursor 的 surfaceGeneration 与当前 surface 不同，返回明确的 history-changed RPC failure，并提供当前 generation（若现有 failure envelope 支持 details）；调用方重新从第一页读取。禁止悄悄把旧 offset 应用到新历史。
- 普通消息追加不改变 generation，现有 cursor 仍有效；压缩 replace 改变 generation，旧 cursor 失效。查询结果不修改历史。
- nextCursor === null 表示该次读取时没有更多条目；后续新增消息由调用方重新查询或通过 follow 得知。

## 5. 错误、取消与兼容性

- 复用当前 RpcMethod、RpcError、Stream RPC 和严格 exactKeys 风格的输入 / 输出验证；不新建并行协议栈。
- 非法输入使用现有 invalid-frame / 输入校验语义；上下文无法解析使用稳定的 session-context-unavailable 错误；旧 history cursor 失效使用 history-changed；Host 关闭 / Bridge 关闭沿用既有 host-unavailable / bridge-closed 语义。
- 不将异常 message 原样转换为模型上下文或静默吞掉；对外 failure message 有界，内部日志可保留诊断信息但不得泄露密钥或工具 schema。
- Stream 取消是正常的生命周期结束：触发 AbortSignal、清理事件监听和活动订阅；不得影响同 Session 的 Agent Turn 或命令。
- 现有 Session 日志与压缩事务 schema 不变；F12.6 只是公开投影层。旧 pressure / overflow / manual 事件继续可读。
- 所有 DTO 均在边界处验证；前端不得将 unknown 强转为信任的类型。

## 6. 文件职责与实施拆分

### Step A：RPC 公共契约

- 新增 rpc/session.ts：三个 RpcMethod、公共类型与 output validator 入口。
- 新增 rpc/session/validation.ts：严格校验 Session ID、预算联合类型、事件联合类型、分页游标和历史条目。
- 更新 rpc/index.ts 导出。
- 复用现有公开 Message DTO；不得让 Renderer 导入后端 src/**。

### Step B：Host 查询与实时订阅

- 新增 src/host/session.ts，并按项目习惯拆出 src/host/session/ 辅助模块（如果确有必要）。
- 在 src/host/main.ts 注册三个方法。
- 上下文快照使用 SessionContextResolver、createGenerateRequest、measureContext、resolveContextBudget；不调用模型。
- 历史查询从 getSurfaceSnapshot() 读取当前 surface，再根据对应事件映射成公开 DTO。
- follow 参考 src/host/project/follow.ts，实现初始快照、按 Session 过滤、序号去重 / 排序、事件队列和 abort 清理。不要透传内部事件或摘要正文。

### Step C：Electron Bridge（串行交接，不并行改共享契约）

- 新增 frontend/shared/session.ts、frontend/shared/session/channels.ts 与 frontend/shared/session/validation.ts：公开 Desktop API、IPC 通道、成功 / 失败结果和事件校验。
- 新增 frontend/electron/ipc/session-context.ts（可按现有目录风格拆 controller）：转发 unary 查询、维护 owner-bound follow 订阅、取消单个订阅，并在 WebContents 销毁时清理。
- 新增 frontend/electron/preload/session.ts：仅暴露受校验的 getContext、getHistory、startContextFollow、cancelContextFollow 和 onContextEvent；不暴露原始 IPC。
- 更新 frontend/electron/main.ts 与 frontend/electron/preload.ts 完成注册和暴露。
- 共享契约与 Host/RPC 改动必须串行确认；不要让前后端 Agent 并行编辑共享协议文件。frontend-plan.md 只记录依赖和前端验收边界，不复制后端实施细节。

### Step D：测试与记录

- RPC：每个输入 / 输出 DTO 的合法与非法形状、未知字段、错误游标、空历史、超出 limit 与错误 frame。
- Host：快照和真实请求使用同一测量口径；预算 disabled 分支；有效历史 checkpoint 映射；普通消息追加后 cursor 稳定；压缩 replace 后 cursor 失效。
- follow：首帧必须是快照；只收目标 Session；压缩 started / checkpoint / ended 均能观察；事件序号乱序时输出稳定；重复事件去重；AbortSignal 后不再收到事件且监听器释放。
- Electron Bridge：IPC 输入和输出校验、Host 关闭、非法输出、start/cancel、不同 WebContents 隔离、窗口销毁取消。
- 完成实际 Electron Bridge 调用验收；本 Step 不要求 UI 页面或点击级上下文面板验收。

## 7. 验收标准

- [x] session.context.v1 返回真实 Session 当前上下文快照，预算字段与现有预算计算一致。
- [x] 查询不会调用 LLM、写 Session 事件、启动 Turn 或触发压缩。
- [x] session.context.follow.v1 首帧是快照；上下文更新和压缩生命周期事件按序到达，不重复、不跨 Session 泄露；取消后监听器释放。
- [x] session.history.v1 返回当前有效 surface，检查点为独立类型，消息顺序和原始 event sequence 正确。
- [x] 追加消息不会使 cursor 无故失效；压缩替换会使旧 generation cursor 返回 history-changed。
- [x] 所有 RPC 与 Electron IPC DTO 有严格运行时校验和稳定错误映射。
- [x] 前端不导入 src/**，不直接接触 Cordis Context / SessionStore / 原始 IPC。
- [x] pnpm typecheck、pnpm test、pnpm --dir frontend typecheck、pnpm --dir frontend test、pnpm --dir frontend build 全部通过。
- [x] 完成 Electron Bridge 的真实调用验收；记录调用输入、输出摘要、取消 / 错误路径与环境。
- [x] 更新本记录、backend-plan.md、frontend-plan.md 和 _docs/index.md；本机验证与当前 PR head CI 均通过后再 squash 合并。
- [x] F12.6 不实现上下文 UI、不改压缩策略、不做 F12.7 长程 AutoRun 验收，也不引入 RAG。

## 8. 本地 Agent 接手要求

- 先阅读 AGENTS.md、_docs/backend-plan.md、_docs/frontend-plan.md、本文件以及 src/session/store.ts、src/context/meter.ts、src/context/budget.ts、src/agent/request.ts、src/host/project/follow.ts。
- 当前工作分支应从 F12.5 合并后的 master 建立；当前设计分支 f12-6-public-context-contract-design 已基于 3c464f5，可以在该 Step 分支继续实施，不要直接修改 master。
- 先实现并验证 RPC / Host 部分，再按前端文件所有权串行完成 Electron Bridge；不得并行编辑共享契约。
- 生产代码改动前再次核对当前 git status 和分支 head；不覆盖用户已有未提交改动。
- 本地完整验证后更新本记录的实现结果、测试数、提交 SHA、PR 与 CI 状态；不要提前把状态标成完成。
- F12.6 收口后才进入 F12.7；F12.3 的本机完整验证跟踪项仍保留，不得在本阶段顺手重写历史结论。

## 9. 设计确认记录

2026-10-17 用户确认采用三个公共接口及上述职责划分。设计记录提交后，等待本地 Agent 按本文件实现；当前文档提交不代表生产代码已实现或验收通过。

## 10. 实现记录（2026-10-18）

### 做了什么

- **RPC 公共契约**（`rpc/session.ts`、`rpc/session/validation.ts`）：新增 `session.context.v1`、`session.context.follow.v1`、`session.history.v1` 三个 `RpcMethod` 与公共 DTO；所有输入 / 输出使用 exact-keys 风格严格校验，包括可选字段、预算联合类型、压缩事件联合类型、分页游标、消息内容块递归结构；`rpc/index.ts` 导出新契约。
- **Host 快照**（`src/host/session/snapshot.ts`）：复用 `SessionContextResolver`、`createGenerateRequest`、`measureContext`、`resolveContextBudget` 与 `SessionStore.getSurfaceSnapshot()`。查询只构造请求并测量，不调用模型、不写事件、不启动 Turn；预算禁用只影响 `budget`，不影响 `measurement`。
- **Host 历史**（`src/host/session/history.ts`）：只读取当前 surface 中实际贡献给模型上下文的条目；普通消息映射为 `message`，`compaction-checkpoint` 映射为独立的 `summary-checkpoint` 并附带事务 ID、覆盖范围和摘要版本；分页使用 `surfaceGeneration + offset`，generation 不一致返回 `history-changed`，`details.surfaceGeneration` 携带当前代。
- **Host 订阅**（`src/host/session/follow.ts`）：先注册 `session/event` 监听，再生成初始快照；首帧固定为 `snapshot`，其 `eventSequence` 是线性化高水位，基线内事件不回放。后续通知不信任投递顺序，而是按 Session 日志序号读取并处理未消费事件，因此天然去重、稳定排序；只处理目标 Session。用户消息、带内容的 Assistant 消息、工具结果与检查点触发 `context-updated`；压缩 started / checkpoint / ended 投影为不含摘要正文的 `compaction-event`；取消、RPC abort、Host 关闭与桥关闭都会移除监听并结束队列。
- **Host 注册与错误映射**（`src/host/session.ts`、`src/host/session/failure.ts`）：在真实 Host 与 Mock Host 注册三个方法；上下文无法解析映射为 `session-context-unavailable`，历史代变化映射为 `history-changed`，其他意外错误映射为 `internal`，不把内部异常正文透传为公共错误。
- **Electron 共享契约**（`frontend/shared/session.ts`、`frontend/shared/session/channels.ts`、`frontend/shared/session/validation.ts`）：定义 `desktop.session` 的 getContext / getHistory / startContextFollow / cancelContextFollow / onContextEvent、IPC 通道、成功 / 失败结果、订阅 ID 与事件校验；失败对象可携带 JSON `details`，用于透传 `history-changed` 的当前 generation。
- **Electron 主进程与控制权**（`frontend/electron/ipc/session-context.ts`）：unary 查询经过输入与输出双重校验；follow 订阅按 WebContents owner 绑定，返回随机订阅 ID，支持单订阅取消、窗口销毁 `cancelOwner` 与 bridge `dispose`；Host 意外结束或帧非法投影为 `context-follow-error`，不向 Renderer 暴露原始 IPC。
- **Preload**（`frontend/electron/preload/session.ts`、`frontend/electron/preload.ts`）：仅暴露 `window.desktop.session` 的五个方法；所有 Host 返回值与推送事件在 preload 再校验一次，原始 IPC 通道不外泄；`frontend/src/env.d.ts` 同步 Renderer 类型。
- **验收工具**（`scripts/host/mock.ts`、`frontend/scripts/qa/session.ts`、`frontend/electron.vite.config.ts`、`frontend/package.json`）：Mock Host 新增 `session-context` 模式，提供可压缩的 Mock 模型容量与脚本化响应；新增 `pnpm --dir frontend qa:session-context` Electron 验收入口，真实经过构建后的 preload、IPC 注册与 Mock Kernel Host。

### 关键不变量

- 快照与真实请求共用同一 `createGenerateRequest` / `measureContext` 口径；只读查询不产生任何 Session 事件，也不消耗模型脚本。
- 历史只投影当前 surface；`sequence` 是原始事件序号，不保证跨检查点单调（检查点事件序号通常大于其后的保留尾部）。
- `eventSequence` 是完整 Session 事件日志高水位，不是消息条数；`surfaceGeneration` 只在前缀替换（检查点）时递增。
- follow 基线以内事件不回放；压缩中途订阅可能只收到 checkpoint / ended，调用方不得假设每个 ended 都有本订阅内的 started。
- 公共历史消息 DTO 不包含 provider replay 数据；它投影模型可见内容块，避免从 `src/llm/**` 暴露私有类型或原始 provider 载荷。
- `rpc/session/validation.ts` 超过 300 行仍保留为单一边界模块：三个 DTO 共享同一组 shape / 原始类型校验助手，拆分会复制助手或制造无语义转发层；该保留理由按仓库治理要求记录于此。

### 测试与验收结果

- `pnpm typecheck`：通过。
- `PATH="/c/Windows/System32:$PATH" pnpm test`：122 个测试文件、771 项测试全部通过（F12.5 基数为 118 / 748；新增 4 个文件、23 项）。
- `pnpm --dir frontend typecheck`：通过。
- `pnpm --dir frontend test`：25 个测试文件、153 项测试全部通过。
- `pnpm --dir frontend build`：通过。
- Electron Bridge 实际调用验收：`NAVO_QA_OUTPUT=frontend/qa-output/f12-6-session-context pnpm --dir frontend qa:session-context` 通过。证据 `result.json` 覆盖：
  - 8 个真实 v2 Turn 后 `getContext`：`eventSequence=56`、`surfaceGeneration=0`、`usedTokens=3144`、预算 `thresholdTokens=8000`、`retainTokens=1600`、`exceeded=false`；
  - 空 `sessionId` 返回 `invalid-input`；
  - `getHistory` 首两页游标为 `{surfaceGeneration:0, offset:3}`，第二页从首页末条之后继续；
  - follow 首帧 snapshot；另一 Session 只收到自己的 snapshot；目标 Session 的 Turn 只向本订阅发送 `context-updated`；
  - `/compact` 后按序收到 `started → checkpoint(generation=1) → context-updated → ended(completed)`；
  - 旧游标返回 `history-changed`，`details.surfaceGeneration=1`；
  - 新历史首条为 `summary-checkpoint`，压缩后 `usedTokens` 从 3144 降至 2026；
  - 取消订阅后继续产生 Turn，订阅事件数保持 7 → 7，不再投递；
  - 环境：Electron 44.2.0、Node 24.20.0。
- 实现提交：`a2481ccd369565e41ff6f5b72ddc7afd673cfe4d`（`F12.6: add public Session context contract`）。
- PR：[#78](https://github.com/likeWind221/Navo/pull/78) 已 squash 合入 master（合并提交 `3bf5e10`）；最终 head `49bb073` CI 通过（run 39089768962，`pnpm typecheck` 与 `pnpm test` 均成功）。

### 坑与发现

- 现有 RPC 没有通用公共消息 DTO；F12.6 在 `rpc/session.ts` 定义了 `SessionHistoryMessageV1` / `SessionHistoryContentV1`，只投影内容块并有意省略 replay。
- `session/event` 通过 Cordis `parallel` 异步发布，不能假设监听器按 sequence 顺序被调用；实现选择“通知只作为唤醒信号，按已提交日志消费”，因此乱序或重复通知不会造成乱序或重复帧。
- 同一次同步批量提交多个消息时，逐事件快照会看到相同最终状态；实现用 `eventSequence + generation + measurement` 去重，只发一个有意义的 `context-updated`。
- Mock Host 的 `agent.turn.v1` 是纯传输 mock，不写 SessionStore；验收改用 `agent.turn.v2` 走真实运行时。`session-context` 模式只为验收提供容量与脚本响应，不改变生产路径。
- Electron 退出时 `userData` 内的 SQLite 观察文件仍被进程持有，清理仅删除 Mock Host 的 home，保留临时 `electron/` 目录；验收证据写入仓库 `frontend/qa-output/`。

### 剩余问题

- 本 Step 只提供 API，不开发上下文用量面板、压缩动画或其他 UI；前端正式页面仍未消费 `window.desktop.session`。
- F12.7 后续已执行：离线通过、真实完成链路因 BUG-014 失败，见 [117](117-devlog-f12-7-acceptance.md)。2026-10-18 已补齐 F12.2 / F12.3 本机完整验证与历史 PR CI 核对，跟踪项已收口，见 [116](116-devlog-f12-verification.md)；前文实施过程中的跟踪说明保留为历史记录。
- 公共历史消息暂不暴露 replay；如果未来 Renderer 需要重放 provider 原生载荷，需要单独设计安全投影，不在本 Step 擅自扩展。
