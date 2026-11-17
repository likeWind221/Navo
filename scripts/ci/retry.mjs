import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const directory = mkdtempSync(join(tmpdir(), "navo-ci-"));
const reportPath = join(directory, "report.json");
const statusPath = join(directory, "status.json");
const vitest = join(process.cwd(), "node_modules", "vitest", "vitest.mjs");
const reporter = join(process.cwd(), "scripts", "ci", "status.mjs");
const args = process.argv.slice(2);

function run(arguments_) {
  rmSync(reportPath, { force: true });
  rmSync(statusPath, { force: true });
  const result = spawnSync(process.execPath, [vitest, "run", ...arguments_,
    "--reporter=default", "--reporter=json", `--reporter=${reporter}`,
    `--outputFile.json=${reportPath}`], { stdio: "inherit", env: { ...process.env, NAVO_CI_STATUS: statusPath } });
  if (result.error || result.status === null) return null;
  try {
    return { code: result.status, report: JSON.parse(readFileSync(reportPath, "utf8")),
      status: JSON.parse(readFileSync(statusPath, "utf8")) };
  } catch { return null; }
}

try {
  const first = run(args);
  if (!first || first.status.errors !== 0 || first.status.reason !== "failed" && first.status.reason !== "passed") process.exitCode = 1;
  else if (first.code === 0 && first.report.success) process.exitCode = 0;
  else {
    const suites = first.report.testResults;
    const failed = suites.flatMap(suite => suite.assertionResults.filter(test => test.status === "failed")
      .map(test => ({ file: suite.name, name: test.fullName })));
    const invalid = suites.some(suite => suite.status === "failed"
      && (suite.message || !suite.assertionResults.some(test => test.status === "failed")));
    if (invalid || failed.length === 0 || failed.length !== first.report.numFailedTests) process.exitCode = 1;
    else {
      let passed = true;
      for (const test of failed) {
        console.log(`\nRetrying failed test: ${test.file} > ${test.name}`);
        const pattern = `^${test.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
        const retry = run([test.file, "--testNamePattern", pattern, "--maxWorkers=1"]);
        if (!retry || retry.code !== 0 || !retry.report.success || retry.status.errors !== 0 || retry.status.reason !== "passed"
          || retry.report.numPassedTests !== 1) passed = false;
      }
      process.exitCode = passed ? 0 : 1;
    }
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
