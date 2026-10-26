import { expect, it } from "vitest";
import { resourceSearchMethod } from "../../../rpc/resource/search.js";
import { parseResourceSearchInput, parseResourceSearchResult } from "../../../rpc/resource/search/validation.js";

it("validates bounded User search input and output status", () => {
  expect(parseResourceSearchInput({ projectId: "p", query: "  question  " })).toMatchObject({
    projectId: "p", query: "question", folder: null, limit: 20, offset: 0,
  });
  expect(() => parseResourceSearchInput({ projectId: "p", query: "q", folder: "a".repeat(4097) })).toThrow();
  expect(() => parseResourceSearchInput({ projectId: "p", query: "q", limit: 101 })).toThrow();
  expect(() => parseResourceSearchInput({ projectId: "p", query: "q", offset: 101 })).toThrow();
  expect(() => parseResourceSearchInput({ projectId: "p", query: "q", unknown: true })).toThrow();
  expect(() => parseResourceSearchInput({ projectId: "p", query: "q", searchToken: "x".repeat(257) })).toThrow();

  const result = {
    projectId: "p", query: "q", folder: null, status: "retrieval-unavailable", errorCode: "embedding-unconfigured",
    results: [], nextOffset: null, searchToken: null, availability: { searchable: 0, pending: 0, failed: 0, unindexed: 1 },
  } as const;
  expect(parseResourceSearchResult(result)).toEqual(result);
  expect(() => parseResourceSearchResult({ ...result, errorCode: "secret-path" })).toThrow();
  expect(resourceSearchMethod.name).toBe("resource.user-search.v1");
});

it("requires one output frame", () => {
  const validator = resourceSearchMethod.createOutputValidator!({ projectId: "p", query: "q", folder: null, limit: 20, offset: 0 });
  expect(() => validator.end()).toThrow();
  const result = { projectId: "p", query: "q", folder: null, status: "no-results", errorCode: null,
    results: [], nextOffset: null, searchToken: null, availability: { searchable: 0, pending: 0, failed: 0, unindexed: 0 } };
  validator.parse(result);
  expect(() => validator.parse(result)).toThrow();
});
