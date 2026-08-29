# SkillWorld 实现计划

**日期：** 2026-08-29
**上游文档：** [00-skillworld-simplified-prd.md](00-skillworld-simplified-prd.md)（PRD，系统核心 = DAG 自主规划 Agent）

**路线总纲（贴合 Agent 学习路程）：**

```
调研探索 → 数据骨架 → 手撕最小主循环 → 记录层 → 端到端跑通
→ 真实 LLM 接入 → Research 模块 → 技能学习应用层 → 验证体系 → 交互层
```

原则：**先懂、再搭、后长。** 每个阶段只加一样东西，全部手撕，不引入 Agent 框架（LangChain 等）。

---

## Phase 0：今天（1 小时内）—— 调研 + 最小可跑主循环

> 目标：不接真 LLM，用 mock 把 PRD 主循环「Planning → Execution → Verification → 再规划」骨架跑通，并落盘可审计记录。

| # | 步骤 | 产出 / 完成标准 | 状态 |
|---|------|----------------|------|
| S1 | **调研：技术决策**（~15min） | ① 确认运行时：Python 3.11+ + asyncio（v0.2 遗留主题）；② 调研本环境可用的 LLM 通道（Claude API / OpenAI 兼容端点 / 本地模型，key 从哪来），只调研不接入，产出 `LLMAdapter` 接口草案；③ 结论写入开发记录 | ✅ |
| S2 | **数据模型 + DAG 核心**（~15min） | `skillworld/graph.py`：`Node` / `Edge` / `GraphVersion`（纯 dataclass，无框架）；实现拓扑取序、成功后解锁后继、环检测 | ⬜ |
| S3 | **手撕主循环 v0**（~20min） | `skillworld/agent.py`：单文件实现 `plan → 执行下一节点 → verify → 通过解锁 / 失败改图(v2) → 重执行`；plan 与 verify 先用**规则式 mock**（可确定、可调试） | ⬜ |
| S4 | **记录层**（~10min） | `skillworld/record.py`：JSONL 追加式事件流（每次改图带 before/after + 理由，每次执行/验证带结果）；图版本快照持久化，可回答"计划为什么变了" | ⬜ |
| S5 | **CLI 端到端演示**（~10min） | `python -m skillworld` 跑一个小目标：≥3 节点 DAG，故意让某节点首次失败 → 触发再规划插入前置节点 → 最终全部通过；打印图版本演化 + 事件流 | ⬜ |
| S6 | **收尾**（~5min） | 写 `01-devlog-phase0-minimal-loop.md`，更新 index 与本文状态 | ⬜ |

**今天不做的：** 真 LLM 接入、Research 模块、Web UI。

---

## Phase 1：真实 LLM 驱动的 Planning

- P1.1 `LLMAdapter` 接口落地：按 S1 调研结论选通道（Mock / Claude API / OpenAI 兼容，环境变量选配置），统一 `complete(messages, json_schema)` 入口
- P1.2 Planning 升级为 LLM：输入 = 目标 + 当前图版本 + 失败上下文，输出 = JSON 图修订（新增/删除/改边 + 每条变更的理由）
- P1.3 图修订校验器：schema 校验 + 环检测 + 节点引用校验，非法修订拒收并回传 LLM 重试（上限 N 次）
- 完成标准：换个新目标，LLM 规划的图能跑通主循环；非法 JSON 有重试与兜底

## Phase 2：Research 模块

- P2.1 调研请求模型：Planning 可发出「追加调研」请求（PRD 主循环要点），Research 产出带来源的知识材料
- P2.2 来源管理：来源注册表（名称、类型：web/文件/API），材料带 citation
- P2.3 材料注入：调研材料作为 Planning 的上下文注入，验证其确实影响图结构
- 完成标准：同一目标，有/无调研材料时，图结构有可观测差异

## Phase 3：技能学习应用层（第一个应用）

- P3.1 能力契约：节点 = 能力单元（可学、可练、可验证的描述）
- P3.2 节点内小闭环：学习 → 练习 → 验证（PRD Execution 层）
- P3.3 用 1 个真实技能（如"用 Python 写单元测试"）跑完整流程
- 完成标准：一个真实技能从目标到"证据判定掌握"全流程跑通

## Phase 4：验证体系 + 自主度

- P4.1 verifier 插件化：规则 / 代码执行 / LLM-judge / 人工确认 四种 verifier
- P4.2 自主度配置：按变更类型（加节点 / 删节点 / 改边）配置全自动 or 需人确认
- 完成标准：失败节点能按配置走不同验证路径；高危变更有人工确认拦截

## Phase 5：交互层

- P5.1 图可视化（Web 页：节点状态、版本切换、变更理由）
- P5.2 人工干预接口：确认 / 修改 / 回滚图版本（利用 S4 的快照能力）
- 完成标准：能在页面上看一张正在执行的 DAG 并干预它

---

## 文档对照

| 文档 | 内容 |
|------|------|
| [00-skillworld-simplified-prd.md](00-skillworld-simplified-prd.md) | PRD（0 号文档，系统核心定义） |
| 本文件 | 计划（步骤单一事实源） |
| [index.md](index.md) | 文档索引（所有文档的状态与路径） |
| `01-` 及以后 | 各步骤开发记录（每步完成即写，见 CLAUDE.md 约束） |
