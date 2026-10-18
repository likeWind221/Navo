# BUG-018：验收脚本混淆被审查回合与审查回合

> 日期：2026-10-18；跟踪：[bug-plan.md](bug-plan.md)；关联：[121](121-bugfix-bug-017-review-evidence.md)
> 状态：代码修复，定向回归通过；本机类型检查与 130 文件 / 793 项通过，代码 head CI 通过，尚未合入

## 现象与复现

BUG-017 新增真实 App + scripted adapter 回归时，Main 成功 fetch 目标证据并提交 complete，但审查证据检查找不到该 Main Turn。此前 F12.7 从未走到完整成功断言，该错误没有被最终检查暴露。

## 已证实事实与根因

src/project/review.ts 的 ReviewService.submit 将 review.turn.turnId 写入 Node.lastReview.turnId；该 ID 表示被审查的 Node 回合，用于 isPending 去重，语义正确。scripts/compaction/checks.ts 却据此在 Main Session 中找同 ID 的 Turn，必然不匹配。BUG-017 初版新审计也沿用了该错误，定向测试明确失败；不修改生产 ReviewService 的正确语义。

## 修复内容

scripts/compaction/turns.ts 的 reviewTurnId 在每个 Main Turn 的首个 llm-requested 中读取系统注入的 review checklist，同时匹配 Node ID、被审查 Node Turn ID、reviewedRevision，返回实际 Main Turn ID。checks.ts 与 evidence.ts 共用该关联，避免凭时间或完成顺序猜测。

## 验证结果与边界

tests/integration/compaction/evidence.spec.ts 验证两个 Node 的 Main 审查 Turn 均与 Node Turn 不同、彼此不同；各自正确关联实际 fetch 结果，缺少记录时拒绝。这里验证运行时关联与读取事实，不声称 mock 证明模型计算正确。

该修复属于本次证据审计必需的验收关联修订，随 F12.7 草稿 PR #79 串行整合；不独立合并尚未通过真实验收的阶段代码。

## 后续

补齐本机完整验证和当前 head CI；阶段完整真实验收通过后随 PR 合入。

本机收口：System32 在 PATH 最前，Node 24.19.0；tsc --noEmit 通过，vitest run --maxWorkers=4 完整 130 文件 / 793 项通过（49.46s）。定向测试同时验证对应实际成功 fetch 返回行和缺行拒绝；当前 head CI 与合入待完成，保持未勾选。

代码提交 dd74d0c 已推送至阶段 [PR #79](https://github.com/likeWind221/Navo/pull/79)，[CI 39116730431](https://github.com/likeWind221/Navo/actions/runs/39116730431) 成功。该项本机和代码 CI 验证通过，阶段尚未合入，保持未勾选；文档收口 head CI 另行核对。
