import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { estimateText } from "../../src/context/meter.js";
import { FILE_LIMITS } from "../../src/tools/builtins/file/types.js";
import { BATCH_COUNT, RECORDS_PER_BATCH } from "./config.js";

export interface BatchExpected {
  readonly batch: number;
  readonly records: number;
  readonly sum: number;
  readonly anomalies: number;
}

export interface ExpectedDataset {
  readonly batches: readonly BatchExpected[];
  readonly totalRecords: number;
  readonly totalSum: number;
  readonly totalAnomalies: number;
  readonly anomalyRecords: readonly string[];
}

export interface FixtureFile {
  readonly path: string;
  readonly text: string;
  readonly lines: number;
  readonly chars: number;
  readonly tokens: number;
  readonly readCost: number;
  readonly readBudget: number;
}

export interface Dataset {
  readonly files: readonly FixtureFile[];
  readonly expected: ExpectedDataset;
  readonly tokens: number;
}

const LINE_COUNT = 310;
const RECORD_POSITIONS: ReadonlySet<number> = new Set([12, 47, 82, 117, 152, 187, 222, 257]);
const LABELS = [
  "Background note",
  "Shift note",
  "Warehouse memo",
  "Audit note",
  "Operations note",
  "Receiving note",
  "Dispatch note",
  "General note",
] as const;
const SENTENCES = [
  "The morning shift reported steady throughput and no unusual events.",
  "The supervisor confirmed that all aisles remained clear during the shift.",
  "Receiving completed routine inspections and found nothing requiring escalation.",
  "Dispatch noted that the scheduled routes ran without disruption.",
  "Inventory staff counted the usual shelves and recorded no surprises.",
  "The overnight team left the floor clean and ready for the next shift.",
  "Safety checks were completed on time and no concerns were raised.",
  "Cycle counts proceeded normally and matched the previous observation.",
  "The warehouse team reported ordinary activity throughout the morning.",
  "Loading dock traffic was steady and all appointments were met.",
  "The quality desk reviewed a routine sample and closed the matter.",
  "Operations confirmed that staffing levels were adequate for the day.",
  "The shift handover covered routine matters and no open issues.",
  "Packing lines ran at the usual pace with no interruptions.",
  "The floor manager observed standard conditions across every zone.",
  "Nothing in the ordinary workflow required attention from management.",
  "Forklift checks were completed and every unit remained available.",
  "The team followed the usual opening checklist without exception.",
  "Labels and paperwork were reviewed and found to be in order.",
  "The final walkthrough confirmed that the facility was in normal condition.",
] as const;

interface GeneratedRecord {
  readonly id: string;
  readonly value: number;
  readonly anomaly: boolean;
}

export function createDataset(): Dataset {
  const files: FixtureFile[] = [];
  const batches: BatchExpected[] = [];
  const anomalyRecords: string[] = [];
  let totalRecords = 0;
  let totalSum = 0;
  let totalAnomalies = 0;

  for (let batch = 1; batch <= BATCH_COUNT; batch += 1) {
    const records = createRecords(batch);
    const path = `data/batch-${String(batch).padStart(2, "0")}.txt`;
    const text = createFileText(batch, records);
    const lines = text.split("\n");
    const chars = text.length;
    const tokens = estimateText(text);
    const readCost = lines.reduce((sum, line, index) => sum + `${index + 1}: `.length + line.length + 1, 0);
    const readBudget = FILE_LIMITS.maxOutputCharacters - JSON.stringify(path).length - 256;
    const sum = records.reduce((value, record) => value + record.value, 0);
    const anomalies = records.filter(record => record.anomaly);
    files.push(Object.freeze({ path, text, lines: lines.length, chars, tokens, readCost, readBudget }));
    batches.push(Object.freeze({ batch, records: records.length, sum, anomalies: anomalies.length }));
    anomalyRecords.push(...anomalies.map(record => record.id));
    totalRecords += records.length;
    totalSum += sum;
    totalAnomalies += anomalies.length;
  }

  return Object.freeze({
    files: Object.freeze(files),
    expected: Object.freeze({
      batches: Object.freeze(batches),
      totalRecords,
      totalSum,
      totalAnomalies,
      anomalyRecords: Object.freeze(anomalyRecords),
    }),
    tokens: files.reduce((sum, file) => sum + file.tokens, 0),
  });
}

export async function writeDataset(root: string, dataset: Dataset): Promise<void> {
  await mkdir(join(root, "data"), { recursive: true });
  await Promise.all(dataset.files.map(file => writeFile(join(root, file.path), file.text, "utf8")));
}

function createRecords(batch: number): readonly GeneratedRecord[] {
  let state = (0x9e3779b9 ^ Math.imul(batch, 0x85ebca6b)) >>> 0;
  return Array.from({ length: RECORDS_PER_BATCH }, (_, index) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return Object.freeze({
      id: `${String(batch).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`,
      value: 10 + (state % 90),
      anomaly: index === 2 || index === 6,
    });
  });
}

function createFileText(batch: number, records: readonly GeneratedRecord[]): string {
  const lines: string[] = [];
  let recordIndex = 0;
  for (let line = 1; line <= LINE_COUNT; line += 1) {
    if (line === 1) {
      lines.push(`SYNTHETIC LEDGER BATCH ${String(batch).padStart(2, "0")} - fictional acceptance data`);
    } else if (line === 2) {
      lines.push("Count only lines beginning with RECORD and ignore every other line.");
    } else if (RECORD_POSITIONS.has(line)) {
      const record = records[recordIndex]!;
      recordIndex += 1;
      lines.push(`RECORD ${record.id} value=${record.value} status=${record.anomaly ? "anomaly" : "ok"}`);
    } else {
      lines.push(createFiller(line, batch));
    }
  }
  return lines.join("\n");
}

function createFiller(line: number, batch: number): string {
  const label = LABELS[(line + batch) % LABELS.length]!;
  const sentence = SENTENCES[(line * 7 + batch * 3) % SENTENCES.length]!;
  return `${label}: ${sentence}`;
}
