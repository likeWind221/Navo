# 81：F9.6f Integration 与 Human Gate

## 做了什么

F9.6f 不再新增 Resource / Mailbox / Context 领域模型，而是把 F9.6 已有能力用真实 Agent Tool 循环串起来验收：

```text
Human start Node A
        |
register_resource
        |
send_to_main
        v
Project Mailbox
        |
Human start Main
        |
read_mailbox
        |
set_resource_access(shared Node B)
        |
        X Node B 不自动执行
        |
Human start Node B
        |
NodeTurnContextBuilder
        |
fetch_resource
        v
读取 Node A Resource 正文
```

完整集成测试通过 Mock LLM 的动态 handler 从前一步 Tool result 中提取真实 ResourceId，再交给下一角色使用，因此没有在测试代码里绕过 Agent capability 直接做 handoff。

## 关键决策

### 补齐 Main 的 Mailbox 消费入口

集成时发现 `send_to_main` 虽然已经把 Node 报告写入 `MailboxStore`，但 Main Agent 没有任何模型可见的读取入口。若测试直接调用 `ResourceService.setAccess`，会掩盖真实链路缺口。

因此新增 Main-only `read_mailbox`：

- caller / project 来自 trusted Main Session Binding；
- 只返回当前 Project 中 Node -> Main 的消息；
- 不消费、不删除消息；
- 不新增 unread/read receipt；
- 不启动 Main/Node，也不修改 Roadmap。

Mailbox 仍是唯一消息事实源。

### Human Gate 作为集成不变量

Main handoff 后明确断言 Node B：

- status 仍为 `idle`；
- 尚未绑定 Session；
- Node event history 没有因 handoff 增长。

只有随后 Human 调用 `nodeSessions.start()` 时，Node B 才构建新的 Context Builder snapshot，并发现刚被授权的 Resource metadata。

### 权限链保持分层

Node A Profile 中：

- 有 `register_resource` / `send_to_main`；
- 没有 `read_mailbox` / `set_resource_access`。

Main Profile 中：

- 有 `read_mailbox` / `set_resource_access`；
- Main 仍不能 update/delete Node-owned Resource。

Node B 读取正文必须走 `fetch_resource`，Resource body 不进入 Context Builder metadata snapshot。

### DeepSeek Harness 对照

只读参考 `packages/session-query/tool-session-query/README.md` 与 session-query subsystem：采用“窄只读 Tool、caller authority 来自运行上下文、读取不改变事实”的职责划分。Navo 的 Mailbox 当前规模和阶段都更简单，因此没有引入搜索、游标、read receipt、持久化 query provider 或动态 follow stream。

## 坑与发现

- 首轮集成 CI 唯一失败是测试断言把“缺省 sessionId”写成 `toMatchObject({ sessionId: undefined })`；Node snapshot 实际省略该可选字段。改成分别断言 `status === idle` 与 `sessionId === undefined` 后通过，生产行为未修改。
- F9.6f 真正发现的产品缺口是 Main 无法消费 Node 写入 Mailbox；补入 `read_mailbox` 后，Node -> Main -> Node 的协调链才是模型可执行的闭环。

## 验证

GitHub Actions Windows CI：

```text
pnpm typecheck  PASS
pnpm test       PASS

72 test files
425 tests
425 passed
```

新增验收覆盖：

- Main `read_mailbox` 只读 Node -> Main 消息，不消费历史；
- Node 即使直接调用全局注册的 `read_mailbox` 也被 Main Binding 拒绝；
- Node A 通过真实 Tool 注册 Resource 并把动态 ResourceId 报告给 Main；
- Main 通过真实 `read_mailbox` 获取报告，再通过真实 `set_resource_access` 授权 Node B；
- handoff 后 Node B 保持 idle 且无 Session / 新执行事件；
- Human 启动 Node B 后，Context Builder 才暴露 Resource metadata；
- Resource 正文不进入 Context snapshot；
- Node B 通过 `fetch_resource` 成功读取正文；
- Resource 最终仍由 Node A owner，Node B 只有 shared Read。

当前仍等待本机 `pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm test`，因此 F9.6f 与整个 F9.6 保持 **🔄**，PR #23 暂不合并。

## 下一步

本机与最终 head CI 双重通过后，将 F9.6f 标记为完成并正式收口整个 F9.6；之后唯一下一步进入 F9.7 Human-Controlled ProjectRuntime。
