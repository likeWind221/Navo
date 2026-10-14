# 95：F10.2 会话与执行记录恢复

## 做了什么

- Main / Node 的现有 `SessionEvent` 原样保存在 `~/.navo/navo.db` 的 `events` 表中，使用 `domain=session`、Session ID 作为 owner、Project ID 作为隔离归属；未改变数据库结构或 schema 版本。
- 保存顺序为：校验事件与待更新的 Surface → SQLite 提交 → 更新内存日志和 Surface → 发布事件。保存失败不改变读模型、不发布事件；模型请求和工具调度的事件先成功保存，才实际执行。
- Host 装配开启会话持久化，等待 Storage / Project / Node 服务可用后恢复日志；恢复不发布事件，不调用模型或工具，后续用户回合继续使用同一 Session。独立 `agent.turn` 的无 Project 会话仍只在内存中。
- 恢复校验覆盖事件结构、Session ID、连续序号、事件 ID 唯一性、消息与工具结果、JSON 数据、Surface 替换及 Project 归属。损坏会话沿用 Project 隔离，其他项目继续工作，损坏原始记录保持不动。
- Responses replay 原样保留，包含无可见正文的 assistant replay；只校验通用封装，具体协议载荷仍由所属模型适配器解释。

```text
Main / Node input -> validate Session event + candidate Surface
                 -> SQLite commit -> update memory -> publish -> model / tool

Host startup -> existing domain recovery -> validate Session ownership + history
             -> restore log + Surface -> wait for Human -> next Turn
```

## 关键决策

- `src/session/store.ts` 拥有事件和 Surface 缓存；`history.ts` 提供写入与恢复共用的运行时校验；`surface.ts` 保存原有消息投影逻辑，避免恢复校验与实时追加各实现一套替换规则；`errors.ts` 是可抛出的会话历史错误边界。类型仍使用 `types.ts` 的既有联合类型，不新增持久化消息协议。
- `src/storage/recovery.ts` 在已有领域投影后检查 Session 归属和历史，在所有 Store 加载前将损坏 Project 排除。`src/storage/database.ts` 仅扩充事件领域联合类型，继续复用同步事务。
- `src/agent/request.ts` 将请求构造与事件保存移入已有 `try/finally`，使保存失败时同样释放模型超时计时器。工具执行之前已有 `tool-call-requested` 追加，写穿透后自然形成执行前保存屏障。
- 本机原 `deepseek-harness/` 快照已不存在。本次只读核对官方仓库 `packages/core/session/src/index.ts`、`packages/session/session-persistence/src/index.ts` 与 `packages/session/session-checkpoint-policy/src/index.ts`：采用既有事件日志、派生消息投影和模型 / 工具执行前持久化语义；不采用其异步写入、独立 flush 插件及多种存储后端。中断收尾仍按已确认的 F10.0 决策留给 F10.3。
- `errors.ts` 少于 40 行仍独立保留，因为它同时被 Session 校验与 Storage 恢复消费，表达领域错误边界。既有 `storage/recovery.ts` 超过 300 行仍保留：它拥有一次启动恢复的跨领域依赖顺序与 Project 隔离集合，没有新增独立状态机；本步只插入 Session 校验阶段。既有 `tests/host/process.spec.ts` 超过 300 行仍保留：新增场景复用同一 Host 进程与 RPC 生命周期辅助函数，属于同一集成验收边界。

## 坑与发现

- Cordis 的服务读取必须发生在对应 inject scope 中；会话恢复与归属查询通过 `storage/projects/nodes` 注入范围装配，不从 App 插件直接读取未注入的服务。
- 系统默认 Node 为 22.23.1，根项目要求 Node >=24；本次验证使用 Codex 自带 Node 24.19.0，并按既有 lockfile 补齐本地缺失依赖，没有改包清单或锁文件。
- Surface 更新必须先在候选副本中完成。直接修改现有缓存后再写数据库，会使失败的消息替换污染下一次模型请求。
- F10.2 不校验回合必须闭合，也不补中断事件；合法的未闭合尾部按原样保存和恢复，运行中的控制器及 active Turn 不恢复。

## 验证结果与边界

- 专项验证已通过：Main / Node 原 Session 续接、完整事件一致性、替换 Surface、opaque replay、保存失败不修改内存或通知、模型 / 工具检查点失败不执行、恢复不自动运行、损坏历史隔离且原记录不变。
- 实际独立 Host 进程退出 → 启动 → 两个原 Session 续接已通过。第二进程的模型请求包含原消息与工具结果；历史前缀保持一致，资源与 Mailbox 记录不重复产生。
- Windows 11 / Node 24.19.0：`pnpm typecheck` 通过；`pnpm test` 98 个文件、618 项全部通过（55.04 秒）。当前 PR head CI 与合并结果待更新。
- 首次全量测试为 617/618 通过，既有 Fetch 本地连接测试在并发套件中超过 5 秒；单独复验该文件 7/7 通过（约 0.44 秒）。未修改该测试或网络代码，重新执行完整套件确认。
- 未进行付费 / 真实模型请求或 Electron 人工验收。本步验收验证后端请求上下文恢复，不宣称模型回答质量或前端历史展示已经验收。

## 下一步

完成本机完整验证与 CI 后按仓库规则合并 F10.2。后续为 F10.3 中断处理：处理未闭合回合与未知工具结果、清理持久化的工作中状态；不自动开始。
