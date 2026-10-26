# 171：F14.2c 目标正文处理取消

日期：2026-10-27。状态：实现与本机 / 正式 Host 验收通过，待当前 head CI；未合并。用户已授权必要后端交接，子 Agent 编码，主编排 Agent 审查与验收。

## 做了什么

新增 `resource.content.cancel.v1`，用户可向指定项目、资料及当前版本的活动正文任务请求取消。精确匹配当前资产代次，不能误取消另一份资料或旧代次。只返回 requested / not-active；实际取消完成仍由既有正文状态流报告 failed / error_code=cancelled。

不撤销已经完成的正文，不把 pending 伪造为已取消，不改变全局处理器关停或重启 processing → pending 的既有语义，不新增队列、并发 Map 或 Agent 回合。

## 关键决策与代码导读

- `rpc/resource/content.ts` 在既有 retry 协议旁新增取消输入 / 结果及单结果契约；`content/validation.ts` 校验精确字段、正整数 expectedRevision 和 requested / not-active 联合状态。输入不重复携带资产代次，使用可信当前 Resource 的代次。
- `src/host/resource/content.ts` 的 createResourceContentCancelHandler 检查提交前取消、转换公开身份并调用 User 服务；正式 Host 在 resource.ts 注册方法，异常沿用既有 Resource failure。
- `UserResourceService.cancelContent` 检查项目仍活动、资料存在且版本匹配，再把当前 projectId / resourceId / assetGeneration 交给处理器；旧页面版本返回 revision-conflict，删除或跨项目资料返回 resource-unavailable。
- `ContentProcessor.cancelCurrent` 只读取已有唯一 active 记录；三项身份全部匹配才 abort 其 controller 并返回 requested，否则返回 not-active。保留原全局 cancel 关停方法，不添加通用调度状态。处理器原 process / contentFailure / store.finish 负责写真实取消结果并通知资料 follow。

关键例子：旧 generation 的 extractor 仍持有租约，替换已提交新 generation。用户按新 revision 取消时返回 not-active，旧任务不被误取消；释放旧任务后，其结果被原代次检查拒绝，新代次照常处理并保存。

## 坑与发现

requested 只证明目标已收到取消请求，不代表持久终态已经写入。pending 没有活动任务，返回 not-active，页面需显示当前事实。首版测试只有错资料 / 版本，主编排要求补齐替换期间旧代次仍活动的关键回归，未添加生产测试 hook。

## 验证结果与边界

Windows PowerShell / bundled Node24.22.1，System32 与 Node24 位于 PATH 前。根包类型检查通过；完整 `NAVO_TEST_MODE=all node node_modules/vitest/vitest.mjs run --maxWorkers=4`：171 文件 / 1080 项通过，266.37 秒，含进程恢复。最终相关 4 文件 / 30 项通过；git diff --check 通过。

主编排独立启动正式 Kernel Host，经 stdio 创建临时项目、导入合成文本并取得 ready 状态；当前版本的取消返回 not-active，陈旧版本返回 revision-conflict，资料状态和版本保持。0 生成 / 0 Embedding。现场 `%TEMP%/navo-f142c-host-xmxOR8` 保留；会话可视化 `f142c/host.json` / `typecheck.log` / `full.log` 保存证据。

正式进程检查证明接口注册、空闲语义及版本约束，不冒充长文件中途取消实测。活动任务的 requested → failed/cancelled、follow 通知、pending 不误取消，以及替换期间旧代次与新代次隔离，由真实 ContentProcessor + 可控 extractor 回归覆盖。Renderer 操作尚待前端 F7.3，不能视为页面完成。

## 下一步

当前 head CI 成功后合并、更新父项和清理专用工作树，继续 F14.3 用户搜索公共交接；前端 F5.4 真实认证门禁仍由 BUG-036 单独跟踪。
