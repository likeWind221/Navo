# F5.2 真实项目入口：接入核对与交接

## 做了什么

用户已确认开始 F5.2：创建、列出和打开真实项目，标签页展示基本信息。只读核对 PRD、backend-plan、src/project/model.ts 以及 Host/RPC/桌面共享接口，未修改后端或公共契约。同步记录 F5.1 用户验收完成。

## 关键决策

后端 F9.1 已完成领域模型，但 F9.9 Public Project / Roadmap Contract Handoff 延期。当前 RPC 只有 agent.turn、agent.turn.v2 和 session.command.v1，没有公开项目管理接口。ProjectSnapshot 仅含 id、goal、mainSessionId、status、revision，没有名称和工作目录。不能把 goal 自动当作项目名称，也不能把 Host 全局文件目录视为每个项目独立目录。

```text
Sidebar / Create
       |
       v
[Pending: desktop project API]
       |
       v
Existing Project domain
       |
       v
Project list / Active tab
```

需后端交付的功能目标：桌面可创建项目、查询项目列表与详情；明确名称、目标和工作目录的含义；明确创建后及重启后的可见性。版本、运行时校验、错误、取消、兼容及列表边界须在唯一写入者负责的公共契约交接中确定。此为待协商需求，不是已冻结 Schema。后端实施交由 backend-plan.md，不在前端计划复制后端具体实施步骤。

## 坑与发现

前序建议中把名称、工作目录和重启恢复作为可接入能力过于提前，现有领域快照和桌面协议并未交付这些能力。遵循 AGENTS.md 前后端所有权边界，停止依赖这些接口的实现并提出交接，不直连私有 Store，也不新增伪持久化项目。

## 验证与下一步

本次仅只读接口核对与文档修改，未运行测试或声称项目链路验收通过。F5.2 等待后端接口交付，未创建前端生产模块、未新增契约。交付后由前端实施项目视图和桥接；不包含真实多会话、历史恢复或研究面板。本次无新增代码导读，最终回复交付阻塞原因与范围。
