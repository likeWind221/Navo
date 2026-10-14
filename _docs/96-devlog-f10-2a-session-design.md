# 96：F10.2a 普通会话保存与重启续接方案

> 2026-10-14。用户已授权补充子步骤与调研具体方案；本记录保留调研与设计依据；方案已于同日获用户确认实施，实际交付与验证见 [97](97-devlog-f10-2a-session.md)。

## 做了什么

- 在 F10.2 与 F10.3 之间新增 F10.2a：普通会话也能保存并在 Host 重启后按原 Session ID 继续上下文，Project Main / Node 复用同一机制。
- 将 F10.3 的通用中断收尾范围扩展到普通 / Main / Node；Node 的 working 状态仍由 Project 领域处理。
- 同步前端交接边界：本步不交付会话列表、历史查询 RPC 或 Renderer 历史展示，不改变 F5.4 的当前前端顺序。
- 只读核对 Navo 源码与 DeepSeek Harness 官方源码；未修改生产代码、测试、数据库或运行配置。

### 当前事实

| 位置 | 已核实行为 | 本步影响 |
|---|---|---|
| `src/session/store.ts` | 已有事件校验、候选 Surface、同步写穿透、提交后通知；持久化注入同时依赖 storage/projects/nodes，没有 Project 绑定时只修改内存 | 保留事件与 Surface 机制，解除对 Project 服务的直接依赖，普通会话同样写库 |
| `src/storage/schema.ts` | schema v1；events 的 project_id 为 NOT NULL；只接受当前版本，否则拒绝打开 | 明确处理已知 v1 升级，保留已有数据；未知版本继续拒绝 |
| `src/storage/database.ts` | 事件按 domain/owner_id/seq 保存，Project ID 是隔离归属；同步事务先提交再应用内存变更 | 扩充 Session 的无 Project 归属，保留其他领域的必需归属 |
| `src/storage/recovery.ts` | 恢复 Session 必须匹配有效 Main / Node；所有领域最后按 validProjectIds 过滤 | 普通会话独立校验和隔离，不被 Project 过滤误删 |
| `src/project/binding.ts` | Main / Node 绑定来自 ProjectStore / NodeStore，同时承担角色与工具能力校验 | 继续作为 Project 绑定事实源，不复制到第二份 Session 注册表 |
| `src/host/turn.ts`、`src/host/turn/v2.ts` | 已接受调用方提供的 sessionId 并交给通用 AgentRuntime | 无须为普通续接新增 Turn RPC；已知原 ID 即可续接 |
| `frontend/src/workspace/chat/conversation/hook.ts` | 普通入口固定发送 local-session，UI 状态没有历史加载入口 | 后端上下文续接与 UI 历史恢复分开验收；多个普通聊天仍不能据此声称已支持 |
| `tests/session/persistence.spec.ts` | 明确断言 standalone unbound Session 临时驻内存 | 这是 F10.2 的既定范围，本步须替换该断言，不登记为已确认 Bug |

## 关键决策：推荐实现

### 1. 复用 SessionStore，不新增存储框架

继续以既有 SessionEvent 为唯一会话事实，Surface 从事件投影恢复。不新增 persisted message 类型，不保存每个流式 chunk，不把 Project 的领域存储搬到 Session 中。

SessionStore 的持久化部分只依赖 Storage；由 `src/app.ts` 在 Project / Node 服务就绪的注入范围中提供可选的 `resolveProjectId(sessionId)` 回调。完整 App 的回调调用既有 `resolveAgentBinding`，绑定存在时返回 Project ID，不存在时返回 null。只装配 Session + Storage 的独立环境无需 Project 回调即可保存普通会话。

回调只负责归属，不能复制 Main / Node 的角色、权限或运行状态。完整 App 必须在对外 ready 前完成回调装配；回调尚未可用不能静默当作无绑定，否则启动期间可能错误保存成普通会话。具体配置形态在实施时沿用 Cordis 注入约束，避免新增一层只有转发作用的 Service。

实时追加主流程：

```text
[existing] Plain / Main / Node input
                     |
[change] resolve optional Project ownership at composition boundary
                     |
[reuse] validate SessionEvent + candidate Surface
                     |
[change] append event with Project ID or null -> SQLite COMMIT
                     |
[reuse] update memory -> publish fact -> model / tool execution
```

恢复主流程：

```text
[change] open known v1/v2 database; upgrade v1 in one transaction
                     |
[reuse] recover Project / Node / Roadmap / Mailbox / Resource
                     |
[change] validate Session log + optional ownership + failure scope
                     |
[reuse] restore events + Surface, without publishing or execution
                     |
[reuse] Host ready -> wait for Human -> Turn with same Session ID
```

图例：change 为本步修改；reuse / existing 为复用。没有自动重试、工具重放或自动继续路径。

### 2. 单表保存，Session 的 Project 归属允许为空

推荐继续使用 events 表，令 project_id 可为 NULL；NULL 只允许 domain=session。其他领域仍必须是有效的非空 Project ID。owner_id 对 Session 仍是 Session ID，主键仍为 (domain, owner_id, seq)，序号继续从 1 连续追加。

类型层用可区分的追加参数表达两种情况：Session 允许 projectId 为 string/null，其他领域必须为 string；SQL CHECK 限定只有 Session 能用 NULL，写入与恢复校验再确认非空 ID，不能只依赖 TypeScript。升级不新增会拒绝旧损坏记录的非空字符串约束，避免阻断原有局部隔离。StoredHistory 可以携带可空归属，但非 Session 恢复分支须先校验并收窄。null 表示普通会话，不使用空字符串、Session ID 冒充 Project ID 或虚构 Project。

同一 Session 的归属在首个事件提交后固定。后续追加校验归属一致，不能把普通会话历史自动改为某个 Project 的历史；绑定冲突应在修改内存或执行模型/工具之前报错。Project 主会话和 Node 会话身份继续由原领域拥有，Session 不另建重复的绑定表。

候选方案比较：

| 方案 | 判断 |
|---|---|
| events.project_id 可空 | 推荐。沿用现有事务、序号和恢复入口，只增加真实需要的无 Project 归属 |
| 新建 session_events 表并搬迁 Project 会话 | 暂不采用。需要第二条事件读写路径或额外共用抽象，当前没有独立存储生命周期的需求 |
| 新建 Session Registry，复制 Main / Node 绑定 | 暂不采用。引入第二份归属事实源和跨 Store 一致性问题；空会话、标题、列表需求尚未进入本步 |
| 给普通会话创建隐式 Project | 不采用。混淆产品领域、隔离语义与工具权限 |

### 3. 已知 schema v1 到 v2 的最小升级

推荐 schema 版本升到 2，在已有 schema 打开事务中仅处理 application_id 匹配且版本为 1 的 Navo 数据库：重建允许 Session 空归属的 events 表，原样复制五列数据，替换旧表和索引，最后设置 user_version=2。workspace_bindings 不变。不修改事件 JSON、ID、序号或原 Project 归属；不计算文件哈希。

复制与版本更新必须同一事务。失败按现有事务错误路径退出，不能部分升级或清库；未知版本和外来 application_id 继续拒绝。已损坏的领域历史仍留给恢复隔离，升级不得因事件 JSON 损坏删除记录。升级约束应兼容 v1 中可存储的旧行，领域有效性由恢复校验判定。

这补充了 [80](80-devlog-f10-0-design.md) 的“不做数据库迁移框架”：只做这次已知旧版本的数据保留升级，不引入通用迁移注册框架；旧二进制遇到 v2 会拒绝打开，不承诺降级兼容。

### 4. 两类恢复隔离与不可用身份

- 普通 Session：校验 ID、序号、JSON、事件与 Surface；某条损坏时隔离整个该 Session，不影响其他普通会话或 Project。
- Project Session：继续核对 Main / Node 归属，损坏时沿用整个 Project 隔离；Project 领域损坏时不能把剩余会话降格成普通会话。
- 同一 Session 出现不同归属，包括 null 与 Project ID 混用时，整个 Session 不恢复，并隔离所涉及的 Project。合法普通日志若占用已知 Main / Node 身份，也视为归属冲突。
- 恢复结果明确区分 Project failure 与 standalone Session failure。可用联合类型保留现有 Project failure 字段，并给普通会话失败加入 kind/sessionId；不通过伪造 projectId 表达错误。
- RecoveryPlan 保留不可用 Session ID 集合；包含损坏普通历史、被隔离 Project 的已存会话及可识别的 Main / Node 绑定。SessionStore 拒绝对这些 ID 追加，不能返回空历史后把原 ID 当成新会话。原始行不改写。
- 数据库或 schema 无法读取仍拒绝启动。只有可以定位到具体会话/项目的领域数据问题才局部隔离；不猜测无法识别的归属。

坏历史 ID 的写入拒绝属于本步恢复边界，不是新增重试或 fallback。未闭合但结构合法的日志保留原样，补工具结果和回合收尾留给 F10.3。

### 5. 文件职责与依赖

| 文件范围 | 拟修改职责 |
|---|---|
| `src/session/store.ts`、`src/session/errors.ts` | 通用保存、可选归属回调、不可用身份与归属冲突错误；保持 Surface/通知顺序 |
| `src/storage/schema.ts` | v2 schema、仅已知 v1 的事务升级 |
| `src/storage/database.ts` | 可区分的追加参数、可空 Session 归属与一致性校验 |
| `src/storage/recovery.ts` | 普通与 Project 会话恢复、两种失败归属、不可用身份；若提取 Session 恢复放 `src/storage/session.ts`，由 recovery 单向调用，不创建独立状态机 |
| `src/app.ts` | 在可信 Project / Node 注入范围提供归属解析；SessionStore 不导入 Project binding |
| `tests/session/persistence.spec.ts`、`tests/storage/database.spec.ts`、`tests/storage/recovery.spec.ts`、`tests/host/process.spec.ts` | 修改既有临时会话断言；覆盖升级、隔离、保存失败、实际跨进程续接；按实施时实际测试归属补充，不预建空文件 |
| `_docs/backend-plan.md`、`_docs/frontend-plan.md`、`_docs/index.md`、本记录 | 步骤状态与交接；F10.2a 尚未实现，不改为 ✅ |

不要求修改既有 SessionEvent / SurfaceOp、模型适配器、工具注册或 RPC 线协议。超过 300 行的 recovery.ts 在实施时复核：若本步显著增加会话解析与隔离逻辑，优先提取明确的 Session 恢复职责，不为行数机械拆文件。

### 6. DeepSeek Harness 对照

本机旧快照不存在；2026-10-14 通过官方 GitHub API 只读核对固定提交 `d743267388641bc76f17c45ce8b4c231aed1d32c`：

| 官方源码 | 采用的原则 | Navo 差异 |
|---|---|---|
| [core/session/src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/core/session/src/index.ts#L634) | 恢复与实时追加使用相同日志/Surface 不变量；日志与派生模型上下文分离 | Navo 已有 history.ts/surface.ts，继续复用；不移植 Harness 的完整 SessionEntry、fork/header 与作用域生命周期 |
| [session-persistence/src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/session/session-persistence/src/index.ts) | 持久化对象就是 SessionEvent，按 Session ID 访问；普通会话存储不依赖 Project | 不新增多后端 Service、逐会话 read/write handle、stat/list、fork lineage 或单写者租约；当前维持单 Host SQLite |
| [session-checkpoint-policy/src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/session/session-checkpoint-policy/src/index.ts#L60) | 模型请求和顶层工具执行前必须保证日志已持久，失败不能执行正文 | Harness 异步 append + flush；Navo 继续同步事务写穿透，无需独立 checkpoint 插件 |
| [core/session/src/repair.ts](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/core/session/src/repair.ts#L200) | 中断尾部收尾依据会话日志，与 Project 无关 | 仅作为 F10.3 的共享会话边界参考；F10.2a 不实现收尾或自动续跑，Navo 原定 failed + 错误码策略保留 |

不可机械照搬当前 Harness 的 append 语义：其内存追加后由插件异步缓冲，flush 才是持久屏障；Navo 的返回成功即已持久约定继续保持。

## 坑与发现

- 公共层不等于公开 RPC。本步得到通用后端保存与续接，前端会话目录与历史展示仍需要独立契约步骤。
- 普通入口已有稳定 local-session，但它只代表当前单会话，不能作为多聊天共享 ID。未来多会话须分配并保存独立 ID。
- 工具权限、系统 prompt、模型和普通会话文件目录目前由可信 Host 配置或 Project Profile 在每个 Turn 构造；日志恢复不会自动恢复旧配置，本步不承诺运行环境与退出前完全相同。
- 被隔离的 Project 从领域 Store 中消失，因此单靠实时 resolveAgentBinding 返回 undefined，无法区别新普通会话与被隔离的旧 Project 会话，必须先查询不可用身份。

## 验证结果与边界

本次完成源码与官方来源核对、计划/索引/相对链接检查和 diff 检查；未运行生产测试、实际数据库升级或重启实验，不宣称方案已通过运行验证。

实施时必要验收：

1. 仅装配 Session + Storage，无 Project / Node 服务时普通日志也保存；同 ID 重开可恢复消息与 Surface。
2. 真实 Host 进程退出并重启：普通会话含消息、工具调用与结果，下一 Turn 的模型请求包含原上下文；启动不调用模型/工具、不重复副作用，另一普通 ID 不串上下文。
3. 保留原 Main / Node 跨进程续接，以及 opaque replay / Surface 替换；保存失败不改内存、不通知，模型/工具检查点失败不执行。
4. v1 数据库包含既有 Project 会话时升级到 v2 并续接；二次启动不重复升级；升级失败保留旧版本及数据；未知/外来数据库拒绝。
5. 损坏一个普通会话，其他普通与 Project 正常；损坏 Project 会话继续整体隔离；损坏原行不变；被隔离 ID 的新 Turn 在执行前拒绝；混合归属拒绝。
6. 未闭合的合法普通会话尾部暂保持原样，由 F10.3 收尾；不得据此宣称完整中断恢复已经交付。
7. 本机完整 `pnpm typecheck` / `pnpm test` 和当前 PR head CI 通过后，按仓库约定合并；用户真实模型验收如需执行，先另报耗时与范围。

## 下一步

调研时后端下一步调整为 F10.2a，之后 F10.3；前端仍为 F5.4。用户随后明确要求按本方案实现，交付与最终状态见 [97](97-devlog-f10-2a-session.md) 及后端计划；本记录中的拟修改职责与必要验收保留为设计依据，不覆盖 F10.2 已完成的验收事实。
