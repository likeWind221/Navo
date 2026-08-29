"""S2 测试：DAG 核心（拓扑取序 / 后继解锁 / 环检测 / clone 独立性）。"""
from __future__ import annotations

import unittest

from skillworld.graph import CycleError, Edge, GraphError, GraphVersion, Node, NodeState


def diamond() -> GraphVersion:
    """a → b, a → c, b → d, c → d（经典菱形，含并行分支）。"""
    return GraphVersion(
        version=1,
        nodes={
            "a": Node("a", "a节点"),
            "b": Node("b", "b节点"),
            "c": Node("c", "c节点"),
            "d": Node("d", "d节点"),
        },
        edges=[Edge("a", "b"), Edge("a", "c"), Edge("b", "d"), Edge("c", "d")],
    )


class TestTopoOrder(unittest.TestCase):
    def test_diamond_order_deterministic(self):
        g = diamond()
        self.assertEqual(g.topo_order(), ["a", "b", "c", "d"])

    def test_single_node(self):
        g = GraphVersion(1, {"x": Node("x", "x")})
        self.assertEqual(g.topo_order(), ["x"])

    def test_empty_graph(self):
        self.assertEqual(GraphVersion(1, {}).topo_order(), [])

    def test_cycle_raises_with_nodes(self):
        g = GraphVersion(
            1,
            {
                "a": Node("a", "a"),
                "b": Node("b", "b"),
                "c": Node("c", "c"),
            },
            [Edge("a", "b"), Edge("b", "c"), Edge("c", "a")],
        )
        with self.assertRaises(CycleError) as ctx:
            g.topo_order()
        for n in ("a", "b", "c"):
            self.assertIn(n, str(ctx.exception))


class TestUnlock(unittest.TestCase):
    def test_root_nodes_unlocked_from_start(self):
        g = diamond()
        self.assertEqual(g.ready_nodes(), ["a"])

    def test_successors_unlock_after_predecessor_passes(self):
        g = diamond()
        g.nodes["a"].state = NodeState.PASSED
        self.assertEqual(g.ready_nodes(), ["b", "c"])  # d 仍被 b、c 卡住
        g.nodes["b"].state = NodeState.PASSED
        self.assertEqual(g.ready_nodes(), ["c"])
        g.nodes["c"].state = NodeState.PASSED
        self.assertEqual(g.ready_nodes(), ["d"])
        # 全部通过后无可执行节点
        for n in g.nodes.values():
            n.state = NodeState.PASSED
        self.assertEqual(g.ready_nodes(), [])

    def test_failed_predecessor_blocks_successor(self):
        g = diamond()
        g.nodes["a"].state = NodeState.FAILED
        self.assertEqual(g.ready_nodes(), [])  # b、c 永不解锁

    def test_passed_node_not_ready_again(self):
        g = diamond()
        g.nodes["a"].state = NodeState.PASSED
        self.assertNotIn("a", g.ready_nodes())


class TestStructureValidation(unittest.TestCase):
    def test_unknown_endpoint_rejected(self):
        g = GraphVersion(
            1,
            {"a": Node("a", "a")},
            [Edge("a", "ghost")],
        )
        with self.assertRaises(GraphError):
            g.check_edges()
        with self.assertRaises(GraphError):
            g.has_cycle()

    def test_has_cycle_false_for_dag(self):
        self.assertFalse(diamond().has_cycle())
        self.assertTrue(
            GraphVersion(
                1,
                {"a": Node("a", "a"), "b": Node("b", "b")},
                [Edge("a", "b"), Edge("b", "a")],
            ).has_cycle()
        )


class TestClone(unittest.TestCase):
    def test_clone_bumps_version_and_is_independent(self):
        g = diamond()
        g.nodes["a"].state = NodeState.PASSED
        v2 = g.clone()
        self.assertEqual(v2.version, 2)
        # 状态保留
        self.assertIs(v2.nodes["a"].state, NodeState.PASSED)
        # 独立性：改 v2 不影响 v1
        v2.nodes["b"].state = NodeState.RUNNING
        self.assertIs(g.nodes["b"].state, NodeState.PENDING)
        # 加边只影响新副本（再规划场景）
        v2.edges.append(Edge("b", "c"))
        self.assertNotIn(Edge("b", "c"), g.edges)


if __name__ == "__main__":
    unittest.main()
