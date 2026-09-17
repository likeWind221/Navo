# 71：F9.6 Project Communication 与 Artifact Handoff 设计

## 1. 背景

F9.5 已完成 Main Agent 的 Roadmap 读取、创建与修改闭环。进入 F9.6 后，核心问题不再是“Main 如何规划”，而是“Node 在执行过程中如何把结果、阻塞、资产和 Project 级请求安全地交回 Main，以及 Main 如何把协调结果交给后续 Node”。

Navo 不以全自动 Workflow 为目标。Project 可以长期存在并持续推进，但每个 Node 的真实执行仍由 Human 明确启动；依赖满足、收到消息或拿到资产都只能让 Node 具备执行条件，不能自动触发 AgentRuntime。

## 2. F9.6 核心契约

### 2.1 Human 是 Node 执行的最终 Gate

```text
Node A 完成工作
      |
      v
报告 / 资产进入 Project
      |
      v
Main 协调并准备 Node B 输入
      |
      v
Node B 已具备执行条件
      |
      X  不自动运行
      |
      v
Human 明确启动
      |
      v
Node B working
```

F9.6 的任何消息、资产交接和 Main 指令都不得直接启动另一个 Node。F9.7 后续即使加入 ProjectRuntime，也必须保留这一人工启动边界。

### 2.2 Main Agent 是唯一跨 Node 协调者

```text
Node A --------X--------> Node B

Node A ---> Project Mailbox ---> Main
Main   ---> Project Mailbox ---> Node B
```

Node 只描述自己的结果、缺失条件或 Project 级请求，不负责定位另一个 Node，也不直接读取其他 Node Session。Main 根据当前 Roadmap 决定由谁处理协调请求。

### 2.3 Node 默认不读取完整 Roadmap

Node 是局部执行单元，而不是“小型 Main Agent”。默认上下文只需要：

- Project Goal；
- 当前 Node 自身定义与 done_when；
- Main 下发给当前 Node 的 directive；
- 分配给当前 Node 的 Project Asset 引用；
- 当前 Node 自己的 Session / 工作区上下文。

完整 Roadmap、跨 Node 依赖解释和 Roadmap Mutation 仍属于 Main Agent 权限。

### 2.4 Artifact 是 Project 一等事实，不通过复制聊天内容传递

Node 产生的文件、调研总结、结构化数据或其他后续可复用产物，应注册为 Project Asset / Artifact Reference，并保留来源信息。

```text
Node A
  |
  +--> research-summary.md
  +--> sources.json
  |
  v
Project Asset Registry
  |
  +--> asset_id
  +--> source_node_id
  +--> source_node_version
  +--> resource reference
  |
  v
Main 按引用分配给 Node B
```

Main 传递的是 Asset Reference，而不是把完整文件内容复制进 Main Session 再复制给 Node B。这样可以保留 provenance，也避免重复上下文。

### 2.5 Message 是 Project Fact，不是递归 Agent 调用

Node 报告只写入 Mailbox；Main 指令也只写入 Mailbox。写消息本身不递归触发 Main 或 Node Agent。

```text
Node Turn
   |
   +--> append message
   |
   v
Turn 结束

Project 后续读取消息并决定下一步
```

这样可以避免 `Node -> Main -> Node -> Main` 的隐藏递归调用链。

## 3. Roadmap 修改请求的处理

用户通常应在 Main Agent 中讨论 Project Roadmap。如果用户在 Node Session 内提出“新增 / 删除 / 重排 Roadmap Node”等 Project 级请求，Node 不获得 `modify_roadmap` 权限。

产品语义提供三个选择：

```text
用户在 Node 中要求修改 Roadmap
              |
              v
      Node 识别为 Project-level
              |
       +------+------+ 
       |             |
       v             v
前往 Main      转交 Main
讨论修改       planning_request
       |
       +-------------+
              |
              v
        Main 读取最新 Roadmap
              |
              v
        Main 决定是否修改

第三种：用户取消 / 不转交，继续当前 Node。
```

后端 F9.6 只负责“转交 Main”的事实能力：Node 可以提交 `planning_request`。跳转 Main、按钮选择等桌面交互属于 F9.9 公共契约 / 前端接入阶段，本阶段不修改 Host / RPC / frontend。

## 4. F9.6 Step 拆分

### F9.6a Project Mailbox Domain

先建立纯领域消息层，不接 Agent Profile。

目标：

- 定义 ProjectMessage / Mailbox history；
- sender / recipient / project 归属可追溯；
- 只允许 `Node -> Main`、`Main -> Node`；
- 同 Project 内也拒绝 `Node -> Node`；
- 消息可按历史重建；
- append message 不触发任何 AgentRuntime。

验收重点：跨 Project、伪造 sender、Node-to-Node 路由都被领域层拒绝，而不是只靠 Prompt 或 Tool 白名单。

### F9.6b Project Asset Registry 与 Artifact Handoff

在消息层之上建立 Project 级资产引用。

目标：

- Node 可以把已有工作产物注册为 Project Asset；
- Asset 保存稳定 ID、来源 Node、来源版本和资源引用；
- Main 可以查看并把 Asset Reference 分配给指定 Node；
- 不复制资产内容，不自动把资产注入其他 Node Session；
- 跨 Project Asset 引用被拒绝。

F9.6b 只建立“资产事实和归属”，不实现数据库持久化；F10 再统一落盘。

### F9.6c Node -> Main Reporting 与 Escalation

给 Node Profile 增加受限报告能力，例如 `report_to_main`。

建议消息语义：

- `result`：阶段性或最终工作结果；
- `blocker`：当前 Node 无法继续的阻塞；
- `coordination_request`：描述“我缺什么”，不直接指定并联系另一个 Node；
- `planning_request`：用户或 Node 识别到需要 Main 处理的 Roadmap / Project 级调整。

报告可以附带当前 Project Asset 引用。sender / projectId / nodeId 必须从可信 Session Binding 派生，不接受模型伪造。

Node 报告 `result` 不等于 Node 已被人工确认完成；生命周期仍按 F9.2 的 Human confirmation 规则处理。

### F9.6d Main -> Node Directive 与 Asset Assignment

给 Main Profile 增加向当前 Project Node 下发协调指令的能力。

目标：

- Main 可以给指定 Node 留下 directive；
- Main 可以关联 / 分配 Project Asset Reference；
- 目标 Node 必须属于当前 Project；
- Main 不能通过该能力直接启动 Node Agent；
- Node 只在后续由 Human 启动的 Turn 中消费这些输入。

这一步完成后，Navo 具备完整但非自动化的协调链：

```text
Node A
  |
  | report + artifact refs
  v
Mailbox / Assets
  |
  v
Main
  |
  | directive + asset assignment
  v
Node B ready context
  |
  X
Human start
  |
  v
Node B Turn
```

### F9.6e Communication Integration 与 Human Gate 验收

最后用完整场景验证 F9.6：

1. Node A 进行网络调研并注册调研产物；
2. Node A 向 Main 报告结果；
3. Main 把相关 Asset Reference 分配给 Node B；
4. Node B 获得可消费输入，但没有自动 Turn；
5. Human 明确启动 Node B 后才执行；
6. Node B 若提出新的 Project 级修改需求，只能通过 `planning_request` 回 Main；
7. Node A 不能直接向 Node B 发消息或转移资产。

F9.6e 不接桌面 UI，不新增自动 Scheduler；它只证明 Core 的通信、资产交接与人工 Gate 边界成立。

## 5. 与 A2A 的关系

F9.6 借鉴 A2A 的两个思想：Agent 保持独立内部状态，跨 Agent 协作通过显式 Message / Artifact Reference 表达。但当前 Navo 是同一 Project 内的分层 Multi-Agent Core，采用 Main-as-coordinator 的星型拓扑，不实现标准 A2A 的 Agent Card、网络发现和跨服务 Transport。

未来若需要连接外部 Agent，可以在 Project Communication 边界增加 A2A Adapter，而无需把内部 Node 改成自由互联网络。

## 6. F9.6 明确不做

- 不允许 Node-to-Node 直接通信；
- 不给 Node `read_roadmap` 或 `modify_roadmap`；
- 不因依赖满足、收到 directive 或 Asset 而自动启动 Node；
- 不让 `result` 报告自动完成 Node；
- 不在工具调用中递归启动另一 Agent；
- 不在 F9.6 修改 Host / RPC / frontend 共享契约；
- 不做数据库持久化，F10 再统一处理；
- 不实现标准网络 A2A Protocol。

## 7. 下一步

先开发 **F9.6a Project Mailbox Domain**。该 Step 只实现可重放的 Project 消息事实、合法路由和领域级权限约束，不接 Agent 工具，不接 Asset，也不触碰运行时调度。
