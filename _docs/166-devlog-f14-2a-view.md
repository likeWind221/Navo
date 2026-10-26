# 166：F14.2a 当前资料查看副本

日期：2026-10-26。状态：✅ 本机、正式 Host 与当前 head CI 通过并合入；前端默认应用打开尚未接入。用户已授权本交接作为前端至 F11 的直接依赖，具体代码由后端子 Agent 编写，主编排 Agent 审查、验收与合并。

## 做了什么

用户可通过版本化 `resource.view-copy.create.v1` 取得当前资料的独立查看副本。输入为 Project / Resource 身份及 expectedRevision；可信 Host 持有读取租约复制当前代次，不修改 Resource、不运行 Agent。副本路径只交可信 Electron 主进程，正式打开按钮和 Renderer 结果由前端 F7.3 后续交付。

不做正文预览、图谱浏览、独立引用、外部编辑回写或正文重处理；后两项重处理与目标任务取消分别由 F14.2b / c 交付。

## 关键决策与代码导读

- `rpc/resource/view.ts` 声明入口、输入与结果，结果携带版本、代次和副本元信息；单结果校验器拒绝空流与重复结果。`view/validation.ts` 校验精确字段、身份字符串和正整数版本；旧资料接口保持兼容。
- `src/host/resource.ts` 注册正式 Host；`src/host/resource/view.ts` 中的 `createResourceViewCopyHandler` 检查取消、把公开身份交给 User 服务，错误统一转换为稳定 Resource failure。工作目录或正文资产不可用映射为 resource-unavailable；版本不符为 revision-conflict。
- `src/resource/user.ts` 提供可信用户入口，`ResourceService.createUserViewCopy` 验证项目和当前资源、通过既有 lifecycle.read 取得固定代次租约，并检查 expectedRevision。User 本就能浏览项目资料，Node 的读取权限没有因此扩大。
- `src/resource/view.ts` 的 `copyResourceView` 创建独立临时目录，按资源身份与原扩展名命名文件，复用 stageAsset 的有界流复制和取消；复制失败或取消后移除未完成目录，成功后只返回副本信息。没有计算哈希或增加完整性校验。
- 租约保证复制期间原代次不被删除，副本取得的是租约时刻的快照。之后替换或删除资源不改变已生成副本，编辑副本也不影响资料原件。

## 坑与发现

成功副本保留在系统临时目录，本步未实现主动回收，不宣称操作系统一定自动清理。Host 退出不删除已打开副本，以免干扰系统应用；后续桌面入口必须只返回打开结果给 Renderer，不把内部资产或副本绝对路径透传到页面。现有 ResourceService 已超过 300 行；本步仅新增专用能力入口，实际复制单独组织，避免扩大通用回调读取接口或进行无关结构重构。

## 验证结果与边界

Windows PowerShell / bundled Node 24.22.1，System32 与 Node 24 位于本进程 PATH 前。根包类型检查通过；完整 `NAVO_TEST_MODE=all node node_modules/vitest/vitest.mjs run --maxWorkers=4`：169 文件 / 1070 项全部通过，259.26 秒，包含进程恢复组。子 Agent 直接相关 6 文件 / 29 项通过，主编排审查实际 diff 与运行引用，git diff --check 通过。

主编排独立启动正式 `src/host/main.ts`，经 NDJSON stdio 创建临时项目、导入一份合成文本、创建副本并修改，再创建第二副本：第二副本保持原内容，原资料不被外部修改；陈旧版本返回 revision-conflict，Host 关闭后首副本仍在。0 生成 / 0 Embedding。现场 `%TEMP%/navo-f142a-host-by6zkp7a` 保留；本会话可视化目录 `f142a/host.json` / `typecheck.log` / `full.log` 保存证据。

针对测试覆盖替换 / 删除后已生成副本保持、跨 Project 访问拒绝及请求开始前取消；复制中租约机制复用既有生命周期检查，不把这些证据夸大为所有系统应用或全部并发竞态均已实测。Electron 默认应用打开和 Renderer 路径隔离尚未交付，不能把本步当作前端 F7.3 完成。

## 下一步

当前 PR head CI 通过后按仓库规则合并，再交付 F14.2b；代码导读随阶段交付说明提供。前端继续完成 F5.4，不依赖本步抢先显示功能按钮。

## 合并结果

[PR #108](https://github.com/likeWind221/Navo/pull/108) 最终 head 3c2a9b1 的 CI run 40353638683 全部通过，verify 3m28s，已 squash 合入 master（528e3a1）。专用分支与工作目录在确认无未提交工作后清理。F14.2 父项仍在进行，F7.3 正式桌面能力仍待前端接入。
