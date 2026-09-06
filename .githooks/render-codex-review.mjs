import { readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";

const [inputPath, outputDirectory, commitSha, commitSubject] = process.argv.slice(2);

if (!inputPath || !outputDirectory || !commitSha || !commitSubject) {
  throw new Error(
    "usage: render-codex-review.mjs <input.json> <output-directory> <commit> <subject>",
  );
}

const data = JSON.parse(readFileSync(inputPath, "utf8"));
const shortCommit = commitSha.slice(0, 7);
const stageCandidate = typeof data.developmentStage === "string"
  ? data.developmentStage.replace(/\s+/g, " ").trim()
  : "开发阶段识别失败";
const developmentStage = stageCandidate.length > 0
  ? stageCandidate
  : "开发阶段识别失败";
const titleCandidate = typeof data.reviewTitle === "string"
  ? data.reviewTitle.replace(/\s+/g, " ").trim()
  : "提交审查";
const reviewTitle = titleCandidate.length > 0 ? titleCandidate : "提交审查";
const stageFilename = developmentStage === "开发阶段识别失败"
  ? "未识别阶段"
  : sanitizeFilenamePart(developmentStage);
const titleFilename = sanitizeFilenamePart(reviewTitle);
const outputPath = join(
  outputDirectory,
  `${stageFilename}--${titleFilename}--${shortCommit}.md`,
);
const reportTitle = `# Git Commit ${shortCommit}（${commitSubject}）— ${developmentStage}`;
const severityOrder = ["high", "medium", "low"];
const severityLabels = {
  high: "🔴 High（严重）",
  medium: "🟠 Medium（警告）",
  low: "🟡 Low（建议）",
};
const categoryLabels = {
  bug: "Bug",
  security: "安全",
  performance: "性能",
  reliability: "可靠性",
  "code-quality": "代码质量",
  "docs-contract": "契约一致性",
  "test-gap": "测试缺口",
  "accidental-change": "意外改动",
};

const findings = Array.isArray(data.findings) ? data.findings : [];
const sections = [];

for (const severity of severityOrder) {
  const group = findings.filter((finding) => finding.severity === severity);
  if (group.length === 0) continue;

  const lines = [`## ${severityLabels[severity]}`, ""];
  for (const finding of group) {
    const category = categoryLabels[finding.category] ?? finding.category;
    const file = (isAbsolute(finding.file)
      ? relative(process.cwd(), finding.file)
      : finding.file).replaceAll("\\", "/");
    lines.push(
      `### [${category}] ${finding.title}`,
      `位置：${file}:${finding.line}`,
      `**问题：** ${finding.problem}`,
      `**影响：** ${finding.impact}`,
      `**建议：** ${finding.suggestion}`,
      "",
    );
  }
  sections.push(lines.join("\n").trimEnd());
}

const reportBody = sections.length > 0
  ? sections.join("\n\n")
  : "未发现需要修改或改进的问题。";
const report = `${reportTitle}\n\n${reportBody}\n`;

writeFileSync(outputPath, report, "utf8");
process.stdout.write(outputPath);

function sanitizeFilenamePart(value) {
  const sanitized = value
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f，；]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.\-]+|[.\-]+$/g, "");
  return Array.from(sanitized || "未命名").slice(0, 80).join("");
}
