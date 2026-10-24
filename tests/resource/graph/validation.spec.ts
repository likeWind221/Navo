import { describe, expect, it } from "vitest";
import { normalizeName, validateGraph } from "../../../src/resource/graph/validation.js";

const entity = { id: "a", name: "Alice", type: "Person", chunkIds: ["c1"] };
const relation = { source: "a", target: "b", type: "KNOWS", chunkId: "c1" };
const valid = () => ({ entities: [entity, { ...entity, id: "b", name: "Bob" }], relations: [relation] });

describe("graph runtime validation and pruning", () => {
  it.each([null, [], {}, { ...valid(), extra: true }, { ...valid(), entities: [7] },
    { ...valid(), relations: [{ ...relation, type: 2 }] }, { ...valid(), entities: [entity, entity] }])
  ("rejects malformed schema: %j", value => {
    expect(() => validateGraph(value, new Set(["c1"]))).toThrow(expect.objectContaining({ code: "invalid-output" }));
  });

  it("prunes missing endpoints, empty relation types and foreign chunks without semantic verification", () => {
    const graph = validateGraph({ entities: [...valid().entities, { ...entity, id: "empty", name: " " },
      { ...entity, id: "foreign", chunkIds: ["outside"] }], relations: [relation,
      { ...relation, source: "missing" }, { ...relation, target: "empty" }, { ...relation, type: " " },
      { ...relation, chunkId: "outside" }] }, new Set(["c1"]));
    expect(graph.entities.map(value => value.id)).toEqual(["a", "b"]);
    expect(graph.relations).toEqual([relation]);
  });

  it("normalizes only Unicode and whitespace while preserving case", () => {
    expect(normalizeName("  Cafe\u0301\t Lab\n")).toBe("Café Lab");
    expect(normalizeName("alice")).not.toBe(normalizeName("Alice"));
    expect(normalizeName("Ａlice")).not.toBe(normalizeName("Alice"));
  });

  it("bounds output cardinality", () => {
    expect(() => validateGraph({ entities: Array(257).fill(entity), relations: [] }, new Set(["c1"])))
      .toThrow(expect.objectContaining({ code: "output-limit" }));
  });
});
