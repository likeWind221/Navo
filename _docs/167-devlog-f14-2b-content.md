# 167：F14.2b 失败正文显式重处理

日期：2026-10-27。状态：✅ 本机、正式 Host 与当前 head CI 通过并合入。用户已授权此交接作为前端至 F11 的直接依赖，后端子 Agent 编码，主编排 Agent 审查、验收与合并。

## 做了什么

新增 `resource.content.retry.v1`：用户对当前版本且正文失败的资料显式重新排队。只返回 accepted / pending，真实 ready 或 failed 仍由既有资料跟随报告，不把接受请求当作恢复成功。不修改正文解析、队列调度或 Agent 触发方式；目标处理取消由 F14.2c 继续交付。

## 关键决策与代码导读

- `rpc/resource/content.ts` 定义输入 Project / Resource / expectedRevision，以及返回资料身份、当前代次和 accepted / pending 的单结果契约。`content/validation.ts` 校验精确字段、字符串、正整数版本和固定返回状态，空流或重复结果无效。
- `src/host/resource/content.ts` 的 createResourceContentRetryHandler 在提交前检查取消，把公开身份交给可信 User 服务，并沿用统一错误转换。`src/host/resource.ts` 注册正式 Host。单次入队为同步提交；取消查询不撤回已接受的队列工作，后续定向任务取消与本请求取消是两件事。
- `UserResourceService.retryContent` 检查项目仍活动、资料存在、版本相符以及当前正文对应当前资产代次；只在状态 failed 时调用既有 ContentProcessor.retry 同步入队。替换会增加 Resource revision，因此无需额外重复传 expectedAssetGeneration；处理器仍拥有代次与晚到结果校验。
- 非失败状态使用资源领域的 content-state-conflict，Host 映射成既有公共 operation-conflict，消息报告实际状态；版本不符沿用 revision-conflict，删除或跨项目资料沿用 resource-unavailable。
- 原队列继续负责 pending → processing → ready / failed，以及 resource/content-changed 和资料 follow；没有新增队列、自动补跑或 Agent 回合。原方法已保证同步入队，未加没有异步边界的重复状态防御检查。

例：正文因空文件失败，用户显式重试后立即收到 accepted / pending；解析再次发现空文件，最终仍报告 failed / empty_content。这是正常失败结果，界面不能把重试按钮的成功回执显示为资料已恢复。

## 坑与发现

首版曾用 operation-result-stale 表达非失败正文状态，审查后改为准确的领域错误并保持公共错误码兼容。首轮开发检查还曾经过系统 Node22 的 pnpm，未用该结果替代基线验证；最终定向和完整检查均明确使用 bundled Node24。

## 验证结果与边界

Windows PowerShell / Node 24.22.1，System32 与 Node24 位于当前 PATH 前。根包类型检查通过；完整 `NAVO_TEST_MODE=all node node_modules/vitest/vitest.mjs run --maxWorkers=4`：171 文件 / 1076 项全部通过，263.28 秒，含进程恢复。相关 6 文件 / 34 项通过。测试分别覆盖失败后真实 ready 和再次 failed、follow 变化、非 failed 拒绝、陈旧版本、替换和删除；fixture 没有 Agent，不触发推理。

主编排独立运行正式 `src/host/main.ts`，创建临时项目并导入空文本，等待真实正文 failed；经新 RPC 重试返回 accepted / pending，队列再次解析并返回 failed / empty_content，陈旧版本被拒绝。0 生成 / 0 Embedding。现场 `%TEMP%/navo-f142b-host-62ak6x__` 与本会话 `f142b/host.json` / `typecheck.log` / `full.log` 保留。

实际 Host 检查证明重新排队和失败终态被如实报告，不冒充真实恢复成功。成功恢复由可控 extractor 回归覆盖。Renderer 重试按钮、交互与用户视觉验收仍待前端 F7.3，不把本步当作前端完成。

## 下一步

当前 head CI 已通过并合入，下一步交付 F14.2c 定向处理取消；共享契约与计划由主编排串行维护。

## 合并结果

[PR #109](https://github.com/likeWind221/Navo/pull/109) 最终 head 46dc7a4 的 CI run 40357840035 全部通过（verify 3m3s），已 squash 合入 master（c7999b3）。专用工作树与分支在无未提交工作后清理；F14.2 父项和前端 F7.3 尚未全部完成。
