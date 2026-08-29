"""SkillWorld DAG 核心：纯数据模型，无框架（S2）。

三件套：
- ``Node``          图上的节点 = 一个待执行、待验证的能力单元（语义由上层应用定义）
- ``Edge``          有向边 src -> dst：src 通过验证后 dst 才解锁
- ``GraphVersion``  某一刻的计划图快照；再规划产生新版本（版本号只增不减）

提供三个原语，主循环（agent.py）只依赖它们：
- 拓扑取序 ``topo_order()``
- 后继解锁 ``is_unlocked()`` / ``ready_nodes()``
- 环检测 ``has_cycle()`` / ``topo_order()`` 抛错
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum


class NodeState(StrEnum):
    """节点执行状态机：pending → running → passed / failed（skipped 由上层再规划使用）。"""

    PENDING = "pending"
    RUNNING = "running"
    PASSED = "passed"
    FAILED = "failed"
    SKIPPED = "skipped"


class GraphError(Exception):
    """图结构错误基类。"""


class CycleError(GraphError):
    """图中存在环。"""


@dataclass
class Node:
    """计划图节点。P0 阶段仅承载状态；能力契约字段在 Phase 3 加入。"""

    id: str
    name: str
    desc: str = ""
    state: NodeState = NodeState.PENDING
    attempts: int = 0  # 已执行次数（失败重试 / 再规划后重跑都会累加）


@dataclass(frozen=True)
class Edge:
    """有向边：dst 只有在 src 通过验证后才可执行。"""

    src: str
    dst: str


@dataclass
class GraphVersion:
    """某版本计划图的完整快照。

    ``note`` 记录该版本为何存在（首次规划 / 因哪个节点失败再规划），
    是"计划为什么变了"审计链的第一手数据（S4 的 record 层会再补事件流）。
    """

    version: int
    nodes: dict[str, Node]  # 保持插入序（用于确定性拓扑）
    edges: list[Edge] = field(default_factory=list)
    note: str = ""

    # ---------- 查询 ----------

    def successors(self, node_id: str) -> list[str]:
        """直接后继。"""
        return [e.dst for e in self.edges if e.src == node_id]

    def predecessors(self, node_id: str) -> list[str]:
        """直接前驱。"""
        return [e.src for e in self.edges if e.dst == node_id]

    def is_unlocked(self, node_id: str) -> bool:
        """解锁规则：全部前驱均通过验证（无前驱的节点天然解锁）。"""
        return all(self.nodes[p].state is NodeState.PASSED for p in self.predecessors(node_id))

    def ready_nodes(self) -> list[str]:
        """此刻可执行的节点：pending 且已解锁（按插入序，确定性）。"""
        return [
            n.id for n in self.nodes.values()
            if n.state is NodeState.PENDING and self.is_unlocked(n.id)
        ]

    # ---------- 结构校验 ----------

    def check_edges(self) -> None:
        """边引用校验：边的端点必须都是图中的节点。"""
        for e in self.edges:
            if e.src not in self.nodes:
                raise GraphError(f"边 {e.src} -> {e.dst}：起点 {e.src} 不在图中")
            if e.dst not in self.nodes:
                raise GraphError(f"边 {e.src} -> {e.dst}：终点 {e.dst} 不在图中")

    def has_cycle(self) -> bool:
        """Kahn 判环：能拓扑排出的节点数 != 节点总数 即有环。"""
        self.check_edges()
        indeg = {n: 0 for n in self.nodes}
        for e in self.edges:
            indeg[e.dst] += 1
        queue = [n for n, d in indeg.items() if d == 0]
        seen = 0
        while queue:
            u = queue.pop()
            seen += 1
            for v in self.successors(u):
                indeg[v] -= 1
                if indeg[v] == 0:
                    queue.append(v)
        return seen != len(self.nodes)

    def topo_order(self) -> list[str]:
        """拓扑序（Kahn）。确定性：入度同时归零的节点按节点插入序排出。

        有环时抛 :class:`CycleError`，异常信息带涉事节点，供再规划提示使用。
        """
        self.check_edges()
        indeg = {n: 0 for n in self.nodes}
        for e in self.edges:
            indeg[e.dst] += 1
        queue = [n for n in self.nodes if indeg[n] == 0]
        order: list[str] = []
        while queue:
            u = queue.pop(0)
            order.append(u)
            for v in self.successors(u):
                indeg[v] -= 1
                if indeg[v] == 0:
                    queue.append(v)
        if len(order) != len(self.nodes):
            stuck = [n for n in self.nodes if n not in order]
            raise CycleError(f"检测到环，涉事节点: {stuck}")
        return order

    # ---------- 演进 ----------

    def clone(self) -> GraphVersion:
        """深拷贝为下一版再规划的起点：版本号 +1，节点独立、状态保留。"""
        return GraphVersion(
            version=self.version + 1,
            nodes={
                k: Node(n.id, n.name, n.desc, n.state, n.attempts)
                for k, n in self.nodes.items()
            },
            edges=list(self.edges),
            note="",
        )
