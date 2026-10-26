# Embedding 模块化与 OpenRouter Nemotron 接入

## 做了什么

用户于 2026-10-26 明确要求新增 `NVIDIA: Nemotron 3.5 Embed 1B (free)`、从环境读取 OpenRouter Key，并将 Embedding 按模型适配器组织，完成验收。从最新 master `a3042ba` 建分支 `phase13-f13.6-embedding-openrouter`；保留上次真实失败的文档提交，未带入 Draft PR #100 的任务验收代码。

- `src/embedding/types.ts` 保持公共 `EmbeddingProvider` 接口，索引与检索仍依赖它。
- 原 `src/embedding/openai.ts` 移到 `src/embedding/protocols/openai.ts`，保留批量检查、请求拆分、超时、取消、有限重试、响应顺序恢复和向量校验；模型标识、维度、输入格式和参数由适配器提供。
- `src/embedding/adapters/qwen.ts` 保留 Qwen3-Embedding-4B / 2560 维、查询指令与索引身份，不因目录调整重建已有兼容索引。
- `src/embedding/adapters/openrouter.ts` 接入 `nvidia/nemotron-3.5-embed-1b:free` / 2048 维，原文作为 input，文档传 `input_type=passage`，查询传 `input_type=query`，输出格式为 float。
- `src/embedding/provider.ts` 统一环境配置与实例创建，Host 改用此入口；`scripts/retrieval/smoke.ts` 同步复用，移除脚本内 Qwen 地址与维度假设。
- 原 Provider 测试移到 `tests/embedding/adapters/qwen.spec.ts`，新增 OpenRouter 请求、配置及同库切换模型、ACL、重启复用集成回归。

## 关键决策

每个 App 选择一个 Embedding Provider，使用公共接口、独立 adapters、共用 protocols 和统一 factory；不增加无实际需求的注册状态机。生成 LLM、图谱、数据库 Schema、索引算法、RPC / Bridge 与前端均不改。

只有显式设置 `EMBEDDING_PROVIDER=openrouter` 才启用；仅存在 `OPENROUTER_API_KEY` 不触发启用。配置方式：

```powershell
$env:EMBEDDING_PROVIDER = 'openrouter'
# OPENROUTER_API_KEY 使用已有环境变量，不写入文件。
```

默认地址为 `https://openrouter.ai/api/v1`，默认模型为指定免费模型。`EMBEDDING_API_KEY` 优先于 `OPENROUTER_API_KEY`；`EMBEDDING_BASE_URL`、`EMBEDDING_MODEL`、`EMBEDDING_REVISION` 保留入口。OpenRouter 目前仅接入该模型，不允许替换 model 字符串却沿用错误维度和模板；不请求自定义 dimensions。省略 provider 时沿用原 Qwen 选择规则。

模型、Provider、revision、维度与模板版本继续由已有兼容性检查决定索引复用。集成测试验证切换后原 Qwen active 索引被 supersede、新索引为 2048 维，相同 OpenRouter 配置重开不重新向量化。已有 failed 构建仍须显式 retry，不修改旧失败现场，不把更换服务视为修复 BUG-032 原端点。

模式依据 [NVIDIA API](https://build.nvidia.com/nvidia/nemotron-3_5-embed-1b)，请求与认证依据 [OpenRouter API](https://openrouter.ai/docs/api/api-reference/embeddings/submit-an-embedding-request)。[模型页](https://openrouter.ai/nvidia/nemotron-3.5-embed-1b:free) 当前标注免费及 2048 维。本轮仅接入文本；图片不在公共接口和验收范围内。

## 坑与发现

新增集成测试首轮漏传 createApp 的 Node session 配置，初始化即失败；补齐 fixture 后专项通过，未发出外部请求。旧路径已从运行引用移除；BUG-030 中的旧路径保留为历史证据。

## 验证结果与边界

- Node 24.22.1 / Windows PowerShell，PATH 将系统目录与 Node 24 置前。
- `pnpm typecheck` 通过。
- `pnpm test tests/embedding tests/host/config.spec.ts tests/integration/embedding.spec.ts tests/resource/index tests/resource/retrieval --maxWorkers=4`：9 文件 / 60 项通过，6.04 秒。
- `pnpm test --maxWorkers=4`：162 文件 / 1045 项全部通过，295.90 秒；未设置 NAVO_TEST_MODE，保留完整进程恢复测试。日志在 `%TEMP%/navo-openrouter-20261026/full.log`。
- 通过临时 tsconfig 单独检查 `scripts/retrieval/smoke.ts`，同时纳入仓库 ambient declarations；首轮临时配置未包含这些声明而报缺失类型，补齐 include 后通过，无须改动生产源码或安装依赖。
- `git diff --cached --check` 通过，旧 Embedding 路径无运行引用，未修改 `frontend/**`。
- 真实请求尚未执行，等待独立预算授权；不把离线成功视为真实模型已通过。
- 真实 smoke 使用新临时目录与合成资料，验证批量输出、索引、中英文排序、权限、原文偏移、重开复用，不接触业务库。图谱、两 Node 与 Main Review 属于 PR #100 的完整任务验收。

## 下一步

完成完整检查后按用户选定范围执行一次真实验收，记录实际请求量、耗时和证据；任一步失败停止，不自动重跑。保留 BUG-031 / BUG-032 状态，满足各自条件才关闭。随后经 PR 与当前 head CI 收口。最终交付包含模块导读和实际边界。
