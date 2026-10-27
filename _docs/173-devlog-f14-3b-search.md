# 173：F14.3b 用户问题检索

日期：2026-10-27。状态：✅ 本机完整检查、正式 Host 受控与当前 head CI 验收通过，已合入。后端子 Agent 编码，主编排审查、验证与共享文档维护。

## 做了什么

新增 `resource.user-search.v1`，用户可按问题检索项目或目录及后代，取得按文件归并的片段、位置和实际命中路由，继续翻页不重复执行 Embedding。资料或检索事实变化后拒绝旧结果，过期或进程重启后要求显式重新检索。保留已有 Agent 检索契约与 Main/Node 权限。

本步不启用正式 Host 图谱抽取模型，不开发 Renderer/Bridge，不建设正文预览、图谱浏览或独立引用管理。内部混合检索仍使用有效的持久图谱，不向公开结果展开图谱实体、关系或完整路径。

## 关键决策与代码导读

- `rpc/resource/search.ts` 与 `search/validation.ts` 定义版本化单结果查询。query 去首尾空白、保留大小写，长度1–4096；folder 限制目录及后代，limit 默认20、1–100，offset 默认0、最多100。结果给出文件分组、片段的UTF16位置、页码、显示标题、全局rank及vector/entity/graph路由。错误区分未配置、无当前索引、资料未就绪、失败与真正空结果，availability 给出互斥的可检索、待处理、失败及未索引数量。
- `src/host/resource/search.ts` 经可信User服务执行查询并由既有Resource错误边界序列化。`search-expired` / `search-changed` 保留为公开稳定错误码；不能让页面解析英文消息猜原因。正常结果不包含密钥、内部资产路径或系统提示词。
- `src/resource/user/search.ts` 的 `UserResourceSearch` 拥有检索操作生命周期：先读取User范围与当前兼容索引，只对正文ready且索引active的资料调用混合检索；异步后重新核对目录版本与配置。先完成全局Chunk排名和每文件最多3片段的归并，再按文件分数、逻辑路径与身份稳定排序。总结果上限沿用100个Chunk，因此最多100个文件。没有可检索资料时不发送query Embedding。
- 快照最多16个、5分钟有效；后续页校验服务端保存的项目、查询、目录、catalog与配置身份，并核对当前资料代次。token仅包含版本与随机操作ID，不重复携带用户查询，也不把客户端自述当成服务端事实。过期/淘汰/重启返回search-expired，资料、配置或图谱事实变化返回search-changed，不自动重搜。过期记录在下一请求时清理，不新增定时器或通用缓存框架。
- `ResourceRetrieval.searchUser`、`IndexSearch.searchUser` 和 `ResourceGraph.readUser` 是可信User入口；旧Agent入口继续要求viewer。两类入口复用原有向量扫描、融合与图谱读取，只分别提供当前授权范围。异步Embedding后重新取范围，最终候选还核对资产代次。公开User结果只在所属边界投影一次，内部Agent的完整路径保持。
- `src/storage/graph/transaction.ts` 在Graph创建、发布、失败、恢复和失效的真实事务内推进catalog版本，旧搜索操作能识别图谱变化。`ResourceGraph.configurationKey()` 描述非敏感抽取配置；没有抽取配置时仍可读取已有有效图谱。`ResourceIndexProcessor.isConfigured()` 用实际配置事实区分未配置与尚未建立索引。

现有权限事实：Main原本可读项目全部资料，Node私有限制的是其他Node。User仍必须走可信服务，因为Agent入口拒绝User principal。新增独立User入口的理由是角色和调用边界，不是声称Main看不到Node私有资料。

## 坑与发现

主审修正了可选viewer/userScope削弱旧契约、只信客户端scope、token重复编码4096字符查询造成输出越界、待处理与未索引重复计数，以及公开错误被泛化的问题。初次正式Host运行在token复用错误上失败，保留 `f143b/first-failure/result.json` 与现场 `%TEMP%/navo-f143b-host-je5bpr9z`，没有把首轮说成成功。

600字符Markdown标题实测会进入内部Chunk元信息；User显示标题限制512字符并加省略号，精确定位仍使用未改动的UTF16偏移与页码。内部标题和Agent结果不截断。Graph probe初版误设Main不能读取私有资料，核对既有ACL后更正断言；未因此修改生产权限。

## 验证结果与边界

Windows PowerShell / bundled Node24.22.1，System32和Node24在PATH前。根类型检查通过；完整 `NAVO_TEST_MODE=all` 176文件 / 1104项通过，267.84秒，含进程恢复。新增3文件 / 15项回归通过，覆盖User与Node私有资料、文件分页且仅一次query Embedding、目录后代、最长查询、快照过期与淘汰、变更/替换/异步期间变化、Graph事实变化、取消、RPC与Host错误。暂存后的diff检查通过。

正式 `src/host/main.ts` + 本地受控OpenAI-compatible Embedding HTTP服务验收通过：导入/整理、两文件分页、目录后代、旧scope拒绝、资料变化拒绝旧页、重启缓存过期、新查询、未配置时0请求。现场 `%TEMP%/navo-f143b-host-1n6aw9tr`；6次本地受控Embedding HTTP、0生成、0远程Embedding，证据 `f143b/host.json` / `host-run.log`。

独立真实领域服务与SQLite的合成持久图谱验收通过：User匹配vector/entity/graph三路，Main保持既有全读，owner Node可读、其他Node不可读；同库重启后无抽取配置仍可读图谱，Graph失效令旧页拒绝。现场 `%TEMP%/navo-f143b-graph-g5OHIa`，证据 `f143b/graph.json`。图谱事实是受控写入，不证明模型抽取质量；本步未运行远程模型、GPU或检索质量评测。

## 下一步

下一步F14.3c接入正式Host显式图谱抽取配置；F14.3父项仍待c。前端F7.1正独立实施只读资料浏览，F7.4搜索Bridge与页面后续消费。F5.4保持Draft，BUG-036真实认证门禁未通过。

## 合并与交接

[PR #114](https://github.com/likeWind221/Navo/pull/114) 最终head `1b8889d` 的CI run `40376239631`成功（verify 3m53s），已squash合入master（`02a9951`）。rebase只接入既有前端排期文档，src/rpc/tests与通过本机验证的版本一致。核对工作树干净、改动已合并后清理专用分支与工作树。计划、索引与本记录同步完成；交付回复提供入口、权限范围、检索复用及快照生命周期的代码导读。
