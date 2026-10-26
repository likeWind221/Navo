# 172：F14.3a 用户目录查询与当前处理状态

日期：2026-10-27。状态：🔄 实现与正式 Host 零推理验收通过，等待最后完整检查及当前 head CI。用户已授权必要后端交接，后端子 Agent 编码，主编排审查和验收。

## 做了什么

用户可通过 `resource.user-query.v1` 按名称或描述查找项目资料，限定某个逻辑文件夹及后代，稳定分页并识别查询期间的资料变化。结果复用旧资料元信息，额外给出当前兼容索引状态。旧 `resource.library.browse.v1` 不增加字段，正式 Renderer 和 Electron Bridge 尚未消费新查询。

本步不包含正文语义检索、GraphRAG 配置、图谱浏览、正文预览、独立引用管理或模型调用。

## 关键决策与代码导读

- `rpc/resource/query.ts` 定义独立版本化单结果方法；`query/validation.ts` 校验字段、分页、token 和索引状态。query 默认空字符串，匹配名称/描述时去首尾空白并转小写；原始与规范化长度均不超过256。limit 为1–100、默认30，offset 默认0。结果 `nextOffset=null` 表示没有下一页。
- `src/host/resource/query.ts` 调用可信 User 服务，把领域快照转为公共元信息和 index 状态。`src/host/resource/view.ts` 复用已有序列化，避免另造资料身份和内容状态。异常沿用 Resource failure，新增加 `query-changed`；已有查询只要求项目存在，归档仍可阅读。
- `src/resource/user/query.ts` 从项目全部活动 Resource 查找，包括用户可读的 Node 私有资料，不冒充 Main，也不扩宽 Agent 的 ACL。按逻辑路径与 resourceId 的代码单元顺序排序，再取 offset 页。取消在开始、筛选/快照后和返回前检查；读取不新建任务或修改资料。
- changeToken 绑定项目、规范化查询、目录、持久目录版本和当前非敏感 Embedding 兼容配置。下一页可带 `expectedChangeToken`；范围、资料或配置变化返回 `query-changed`，要求用户明确从第一页刷新。正常重启不生成随机 token。token 不包含密钥或服务 URL，也不扫描/哈希资料文件。
- `src/storage/catalog.ts` 提供项目级持久版本，schema v8 增加 `resource_catalog_versions`。旧项目没有版本行时按0读取。资源事件、目录、正文与索引可见状态在各自实际写入事务内递增；回滚连版本一起撤销，无变化或幂等重试不凭空增加。索引块向量分批写入期间，公开 building 状态不变，因此不因每批向量落库增加目录版本。
- `ResourceIndexProcessor.currentStatus` 只使用当前代次 ready 正文及现有 `compatible()` 判断 building / active / failed；只有历史或不兼容索引时为 stale，未配置时为 waiting-config。pending / failed / metadata_only 正文的 index 为 absent，正文失败仍由独立 content 状态显示。`configurationKey()` 只描述兼容事实，不增加另一套兼容规则。

例子：用户查 `docs` 及后代的 needle，拿到第一页及 token；资料替换、描述变化或 Embedding 配置改变后继续用旧 token 翻页，会收到 query-changed，而不是把旧 offset 套到已变化的列表。同一库、同一配置的正常重启仍接受原 token。

## 坑与发现

首版 no-op 回归吞掉 publish 失败，主审要求移除 catch 和条件跳过；现在前置发布失败会直接使测试失败。Unicode 的 `İ` 转小写会扩展为两个代码单元，因此输入校验同时限制规范化后的长度，避免合法输入产生无法通过自身输出校验的结果。

查询当前为同步读取与分页，不承诺大规模目录性能；本步没有新增缓存、调度器或后台重试。查询版本用于识别变化，不是认证凭据或文件完整性证明。

## 验证结果与边界

Windows PowerShell / bundled Node24.22.1，System32 与 Node24 在 PATH 前。首轮类型检查及完整 all 模式173文件 / 1085项通过（263.62秒）；审查修订后的最终检查结果将在交付前补齐。相关检查覆盖 User 范围、Main/Node 原权限、目录后代、分页与scope变化、版本事务回滚、同配置重启和配置变化、当前索引状态、RPC输入输出及预取消。客户端预取消证明未提交，领域预取消证明不返回页面，不冒充已实际执行的长查询中途取消。

正式 `src/host/main.ts` 经 stdio 验收：新临时项目导入两份合成文件，等待正文ready，整理到 docs / docs/sub，按描述两页查询、错误limit拒绝、查询范围及描述变化后的旧token拒绝、旧browse结果无index、关闭重启同库后查询结果与token保持，全部通过。0生成 / 0Embedding；现场 `%TEMP%/navo-f143a-host-_anop_nm`，证据在会话可视化 `f143a/host.json`、`first.stderr.log`、`restart.stderr.log`。兼容索引各状态由本地可控Provider回归覆盖，未声称远程Embedding或正式页面已经验收。

## 下一步

本机最终检查和当前 head CI 均成功后合并、更新交接状态并清理工作树；继续 F14.3b 用户问题检索与正式 Host 图谱配置。F5.4 真实 Main 仍受 BUG-036 认证问题阻断，保持 Draft。
