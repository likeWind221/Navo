# S2 开发记录 — 数据模型 + DAG 核心

**日期：** 2026-08-29
**对应步骤：** plan.md Phase 0 / S2

## 做了什么

- `skillworld/graph.py`（纯 dataclass，零依赖）：
  - `NodeState`：pending → running → passed / failed（+skipped 留给再规划）
  - `Node`：id / name / desc / state / attempts
  - `Edge`（frozen）：src → dst，语义 = "src 通过验证后 dst 才解锁"
  - `GraphVersion`：version / nodes（保插入序）/ edges / note；提供 `successors` / `predecessors` / `is_unlocked` / `ready_nodes` / `check_edges` / `has_cycle` / `topo_order` / `clone`
- `tests/test_graph.py`：11 个用例全过（`python -m unittest discover -s tests`）

## 关键决策

1. **本步前补了一个真正的决策**：语言此前只是 S1 的遗留待决事项，经用户确认为 Python 3.12；测试定为标准库 unittest（不装 pytest）。CLAUDE.md 工程约定、01 号 devlog 已同步。
2. **状态放 `Node`，版本放 `GraphVersion`**：节点状态跟着图版本快照走，`clone()` 产 v+1 时状态保留（失败节点带着 FAILED 进入新图，这是再规划的输入）。
3. **`topo_order` 用 Kahn + dict 插入序保证确定性**：同入度节点按声明顺序排出，可复现、可测试。
4. **`CycleError` 带涉事节点列表**：为 Phase 1 "非法修订回传 LLM 重试"预留可读的错误信息。

## 坑与发现

- Kahn 判环与拓扑序是同一套代码的两种用法（seen != n 即有环），合并后只维护一份入度逻辑。
- `Edge` 设为 frozen dataclass，天然可作 dict/set 元素，后续做边的 diff（S4 before/after）会省事。

## 下一步

S3：`skillworld/agent.py` 主循环 v0（plan → 执行下一节点 → verify → 通过解锁 / 失败改图 v2 → 重执行），plan 与 verify 用规则式 mock。
