# BUG-018：验收脚本混淆被审查回合与审查回合

> 日期：2026-10-18；跟踪：[bug-plan.md](bug-plan.md)；关联：[121](121-bugfix-bug-017-review-evidence.md)
> 状态：修复、本机完整验证、真实最终断言与当前 PR head CI 通过；PR #79 已合入，关闭

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

## 18:24 完整真实验收收口

代码 61bee29，gpt-6-luna，228699ms / 28 请求（25 任务 + 3 摘要），runner exitCode=0。三次 pressure 压缩 37074→17687、39383→18593、33072→11481，均被后续任务复用。审查前暂停、原始 JSON 交接、同库重启严格比较通过，模型请求数 14→14，无自动恢复请求。A / B JSON 独立校验均正确，80 条 / 总和 3958 / 20 异常；两 Node 均经 Main complete、零返工，AutoRun roadmap-complete，最终断言全部通过。

证据：C:/Users/likeW/AppData/Local/Temp/navo-f127-luna-20261018-182432/；按需审查 A 1596 字符、B 2507 字符，均未注册新资源或重读原始大文件。当前记录覆盖原关闭条件，不覆盖通用 TRANSPORT 底层诊断修复。完整范围见 [117](117-devlog-f12-7-acceptance.md) 与 [121](121-bugfix-bug-017-review-evidence.md)。本机 793 项、类型检查及代码 head CI 已通过；最终文档 head CI、PR #79 合并结果在收口记录补记。

## 合并与收尾

PR #79 已在当前 head 59ccd86 的全部 CI 成功后 squash 合入 master，合并提交 272916b695c57ad3f8f4d4470288d627386dcd0d。CI run 39119616113 第一次 4 项既有测试超时（Host process / Roadmap）；未修改代码或测试门槛，本机对应 3 文件 / 24 项原样通过（45.07s），同一 head CI 第二次全部通过（verify 1m32s）后才合并。真实验收证据与历史失败证据保留；合并不修复 BUG-019。

本次阶段及 BUG-014～017 的本地开发分支已清理；没有为本次新增专用 worktree，主仓库及其他任务工作树保留。后续仅提交此治理记录，不重新运行模型或开始下一 Step。
