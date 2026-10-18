import type { NodeObjective } from "../../src/node/model.js";
import { BATCH_COUNT, RECORDS_PER_BATCH } from "./config.js";
import type { ExpectedDataset } from "./data.js";

export const NODE_A_TITLE = "Summarize ledger batches";
export const NODE_B_TITLE = "Verify final ledger result";
export const SUMMARY_PATH = "out/summary.json";
export const FINAL_PATH = "out/final.json";
export const SPOT_CHECK_BATCHES = [1, 5, 10] as const;

export interface Validation {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

const SUMMARY_KEYS = ["batches", "totalRecords", "totalSum", "totalAnomalies", "anomalyRecords"] as const;
const SUMMARY_BATCH_KEYS = ["batch", "records", "sum", "anomalies"] as const;
const FINAL_KEYS = ["verified", "totalRecords", "totalSum", "totalAnomalies", "spotChecks", "discrepancies"] as const;
const FINAL_SPOT_KEYS = ["batch", "records", "sum", "anomalies"] as const;

export function nodeAObjective(): NodeObjective {
  const shape = JSON.stringify({
    batches: Array.from({ length: BATCH_COUNT }, (_, index) => ({
      batch: index + 1,
      records: RECORDS_PER_BATCH,
      sum: 0,
      anomalies: 0,
    })),
    totalRecords: 0,
    totalSum: 0,
    totalAnomalies: 0,
    anomalyRecords: [],
  });
  return {
    title: NODE_A_TITLE,
    description: [
      "Process all ten synthetic ledger files in data.",
      "For each batch from 1 through 10, call read once with maxLines set to 1000 and path data/batch-01.txt through data/batch-10.txt in ascending order.",
      "Wait for each read result before issuing the next read; never issue two read calls in one step and never read a file twice.",
      "After each read result, before moving on, state in one short visible line that batch's record count, sum, anomaly count and anomaly IDs as you computed them from that file. Put that progress line in the same response as the next tool call: the next read for batches 1 through 9, and submit_completion after batch 10. Never send a text-only response and never add a separate planning step.",
      "In each file count only lines that begin with RECORD, sum the integer in their value= field, and count lines whose status= field is anomaly. Ignore every other line.",
      `After all ten reads, call submit_completion exactly once. Put the complete result JSON itself in the summary field as one string, with no Markdown fences and no prose before or after it. Keep the JSON compact on one line with no indentation or extra whitespace. The JSON must have exactly this shape: ${shape}`,
      "Use the computed values, JSON numbers rather than strings, one batches entry per batch in ascending order, anomalyRecords as NN-MM in ascending order, and no other keys.",
      "In the same submit_completion call set resource_ids to an empty array, set remaining to an empty array, and include exactly one criteria entry for each acceptance criterion with the matching criterion_index, satisfied true and a short note.",
      "Do not use write, register_resource, shell, web_search, web_fetch or any tool other than read and submit_completion. Do not create files or Resources.",
    ].join(" "),
    acceptanceCriteria: [
      "The completion summary field contains exactly one JSON object with the required summary keys and one batch entry for each of the ten files, and the Node work log shows one read of each batch file in order.",
      "The completion signal marks every acceptance criterion satisfied, sets resource_ids and remaining to empty arrays, and carries the result JSON in its summary.",
    ],
  };
}

export function nodeBObjective(): NodeObjective {
  const shape = JSON.stringify({
    verified: true,
    totalRecords: 0,
    totalSum: 0,
    totalAnomalies: 0,
    spotChecks: SPOT_CHECK_BATCHES.map(batch => ({ batch, records: RECORDS_PER_BATCH, sum: 0, anomalies: 0 })),
    discrepancies: [],
  });
  return {
    title: NODE_B_TITLE,
    description: [
      `Read ${SUMMARY_PATH} from the shared Project Workspace. The acceptance harness created that file from Node A's original completion summary and also published it as a public Main-owned Resource; use read on the workspace file and do not expect a private upstream Node Resource.`,
      "Then call read once for each of data/batch-01.txt, data/batch-05.txt and data/batch-10.txt with maxLines set to 1000, one file at a time in that order.",
      "For each spot-check batch, recompute the RECORD count, the sum of value= integers and the anomaly count from the raw file, and compare them with the summary.",
      `After the four reads, call submit_completion exactly once. Put the complete final JSON itself in the summary field as one string, with no Markdown fences and no prose before or after it. Keep the JSON compact on one line with no indentation or extra whitespace. The JSON must have exactly this shape: ${shape}`,
      "Set verified to true only when the three spot checks match the summary and the summary totals equal the sum of its per-batch entries.",
      "Keep spotChecks in the order 1, 5, 10, use JSON numbers rather than strings, leave discrepancies as an empty array, and do not add other keys.",
      "In the same submit_completion call set resource_ids to an empty array, set remaining to an empty array, and include exactly one criteria entry for each acceptance criterion with the matching criterion_index, satisfied true and a short note.",
      "Do not use write, register_resource, shell, web_search, web_fetch or any tool other than read and submit_completion. Do not create files or Resources.",
    ].join(" "),
    acceptanceCriteria: [
      `The completion summary field contains exactly one JSON object with the required final keys, verified=true, the totals, spot checks for batches 1, 5 and 10, and an empty discrepancies array, and the Node work log shows reads of ${SUMMARY_PATH} and those three batch files in order.`,
      "The completion signal marks every acceptance criterion satisfied, sets resource_ids and remaining to empty arrays, and carries the result JSON in its summary.",
    ],
  };
}

export function validateSummary(text: string, expected: ExpectedDataset): Validation {
  const errors: string[] = [];
  const value = parseObject(text, errors);
  if (value === undefined) return result(errors);
  exactKeys(value, SUMMARY_KEYS, "summary", errors);
  const batches = value.batches;
  if (!Array.isArray(batches) || batches.length !== expected.batches.length) {
    errors.push(`summary.batches must contain ${expected.batches.length} entries`);
  } else {
    expected.batches.forEach((batch, index) => {
      const entry = batches[index];
      if (!isObject(entry)) {
        errors.push(`summary.batches[${index}] must be an object`);
        return;
      }
      exactKeys(entry, SUMMARY_BATCH_KEYS, `summary.batches[${index}]`, errors);
      compare(entry.batch, batch.batch, `summary.batches[${index}].batch`, errors);
      compare(entry.records, batch.records, `summary.batches[${index}].records`, errors);
      compare(entry.sum, batch.sum, `summary.batches[${index}].sum`, errors);
      compare(entry.anomalies, batch.anomalies, `summary.batches[${index}].anomalies`, errors);
    });
  }
  compare(value.totalRecords, expected.totalRecords, "summary.totalRecords", errors);
  compare(value.totalSum, expected.totalSum, "summary.totalSum", errors);
  compare(value.totalAnomalies, expected.totalAnomalies, "summary.totalAnomalies", errors);
  compareStrings(value.anomalyRecords, expected.anomalyRecords, "summary.anomalyRecords", errors);
  return result(errors);
}

export function validateFinal(text: string, expected: ExpectedDataset): Validation {
  const errors: string[] = [];
  const value = parseObject(text, errors);
  if (value === undefined) return result(errors);
  exactKeys(value, FINAL_KEYS, "final", errors);
  if (value.verified !== true) errors.push("final.verified must be true");
  compare(value.totalRecords, expected.totalRecords, "final.totalRecords", errors);
  compare(value.totalSum, expected.totalSum, "final.totalSum", errors);
  compare(value.totalAnomalies, expected.totalAnomalies, "final.totalAnomalies", errors);
  const spots = value.spotChecks;
  if (!Array.isArray(spots) || spots.length !== SPOT_CHECK_BATCHES.length) {
    errors.push(`final.spotChecks must contain ${SPOT_CHECK_BATCHES.length} entries`);
  } else {
    SPOT_CHECK_BATCHES.forEach((batchNumber, index) => {
      const entry = spots[index];
      if (!isObject(entry)) {
        errors.push(`final.spotChecks[${index}] must be an object`);
        return;
      }
      exactKeys(entry, FINAL_SPOT_KEYS, `final.spotChecks[${index}]`, errors);
      const batch = expected.batches.find(candidate => candidate.batch === batchNumber)!;
      compare(entry.batch, batch.batch, `final.spotChecks[${index}].batch`, errors);
      compare(entry.records, batch.records, `final.spotChecks[${index}].records`, errors);
      compare(entry.sum, batch.sum, `final.spotChecks[${index}].sum`, errors);
      compare(entry.anomalies, batch.anomalies, `final.spotChecks[${index}].anomalies`, errors);
    });
  }
  if (!Array.isArray(value.discrepancies) || value.discrepancies.length !== 0) {
    errors.push("final.discrepancies must be an empty array");
  }
  return result(errors);
}

function parseObject(text: string, errors: string[]): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text);
    if (isObject(value)) return value;
    errors.push("document must be a JSON object");
  } catch {
    errors.push("document is not valid JSON");
  }
  return undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string, errors: string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    errors.push(`${label} must contain exactly the keys ${expected.join(", ")}`);
  }
}

function compare(actual: unknown, expected: number, label: string, errors: string[]): void {
  if (typeof actual !== "number" || !Number.isSafeInteger(actual) || actual !== expected) {
    errors.push(`${label} must be the integer ${expected}`);
  }
}

function compareStrings(actual: unknown, expected: readonly string[], label: string, errors: string[]): void {
  if (!Array.isArray(actual) || actual.length !== expected.length
    || actual.some((value, index) => value !== expected[index])) {
    errors.push(`${label} must equal ${JSON.stringify(expected)}`);
  }
}

function result(errors: readonly string[]): Validation {
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze([...errors]) });
}
