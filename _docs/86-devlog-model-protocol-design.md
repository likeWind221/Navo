# 公共模型协议层与 ChatGPT 订阅接入方案

日期：2026-10-13。状态：M1.1、M1.2 分别经 PR #49、#51 合并完成；M1.3 已获授权实施，真实账号登录、模型目录与撤销通过，等待合入验收，记录见 [91](91-devlog-m1-3-chatgpt-auth.md)。用户已选择新 ChatGPT 订阅线路，并要求建立可供后续厂商复用的公共协议层；M1.4 尚未开始。

## 做了什么

检查现有 Qwen 请求、SSE、LLMService、流聚合、Agent 请求与 Session 投影，并补读 DeepSeek Harness 官方源码。形成四个候选后端子步骤；此文件记录实现决策，确认后才把功能目标与验收标准写入 backend-plan.md。不替代或重编号当前 F10 持久化步骤。

本轮只新增方案文档、更新调研与索引。工作区已有用户修改的 AGENTS.md，保留原样；当前分支为 F10.1c，未来实现从最新 master 新建独立 Step 分支，不直接在当前分支实现。

## 关键决策

### 1. 三层职责，不新增第二套适配器入口

| 边界 | 所有者 | 职责 |
|---|---|---|
| 通用模型调用 | LLMAdapter / LLMService | 继续使用 GenerateRequest → ModelEvent；按 provider 注册和分发，统一失败及消费取消 |
| 厂商接入 | QwenChatCompletionsAdapter / OpenAIAdapter | 地址、认证、接入参数限制、HTTP 请求、HTTP 错误和连接释放；选择使用哪种公共协议 |
| 公共通信协议 | completions / responses | 消息、工具和结果序列化；供应商响应结构校验；有序内容、usage、finish 与 replay 的转换 |
| 订阅认证 | ChatGPT 认证模块 | 独立登录尝试、账号注册、凭据保存、刷新、登出；不持有模型流解析状态 |

协议模块不依赖厂商 Adapter、Host、SessionStore 或账号令牌；只依赖通用 LLM 类型与必要的 SSE 解帧能力。Adapter 依赖协议模块。依赖方向固定，协议模块中不按 provider 名称判断厂商。

Qwen Adapter 的公开类名与导出保持不变，避免纯提取同时改变公共符号。新增类叫 OpenAIAdapter，provider 配置值为 openai；本轮仅支持 ChatGPT 订阅认证，界面/命令说明明确这一点，不暗示已支持 API key。

### 2. 候选目录与文件职责

```text
src/llm/
  adapter.ts                    existing unified interface
  service.ts                    existing registry / routing / cancellation
  types.ts                      canonical facts + opaque replay envelope
  accumulator.ts                content and replay alignment
  collect.ts                    collect one model response
  adapters/
    qwen.ts                     Qwen-specific config + HTTP lifecycle
    openai.ts                   subscription constraints + HTTP lifecycle
  protocols/
    sse.ts                      shared byte decoding / SSE framing / reader cleanup
    completions/
      request.ts                Chat Completions serialization
      stream.ts                 Chat Completions event translation
    responses/
      request.ts                Responses serialization / history restoration
      stream.ts                 Responses event state machine
      replay.ts                 protocol-private replay validation / restoration
  auth/
    chatgpt.ts                  credential-session owner / refresh serialization
    chatgpt/
      flow.ts                   one OAuth login attempt + callback lifecycle
      store.ts                  protected local credential records
      token.ts                  token exchange / refresh / OIDC validation
scripts/
  chatgpt.ts                    login / logout / models command entry
```

目录不是强制逐个建文件的清单：实际实现按职责与状态所有权复核文件粒度，不建立空文件或内部 re-export index。协议流状态与 OAuth 登录状态分属不同所有者，不混在同一文件。

另需修改 src/host/config.ts、src/host/main.ts、src/agent/request.ts 及相关类型/事件消费，按下面步骤逐次交付；若 Session 现有结构即可保留新字段，只补验证，不机械修改 store。根 package.json 可增加本地认证命令；OIDC 校验使用成熟标准库（候选 jose），所需依赖只进入根包清单和锁文件，不手写 JWT 签名算法。

### 3. 输入到输出主流程

```text
Authentication path                         Inference path

[NEW: login command]                        [REUSE: Human starts a Turn]
         |                                                |
         v                                                v
[NEW: browser / loopback OAuth]             [REUSE: Session history + tool schemas]
         |                                                |
         v                                                v
[NEW: validate identity + permission]       [REUSE: LLMService provider routing]
         |                                                |
         v                                    +-----------+-----------+
[NEW: protected credential store]              |                       |
         |                                     v                       v
         v                           [MODIFY: Qwen Adapter]   [NEW: OpenAIAdapter]
[NEW: serialized token refresh]                |                       |
         |                                     v                       v
 [OUTPUT: token for OpenAIAdapter]    [EXTRACT: Completions] [NEW: Responses]
                                               |                       |
                                               +-----------+-----------+
                                                           |
                                                           v
                                             [MODIFY: ModelEvent + replay]
                                                           |
                                                           v
                                             [MODIFY: collect / message assembly]
                                                           |
                                                           v
                                             [REUSE: Session + local tool runtime]
                                                           |
                                                           v
                                             [REUSE: next model request / answer]
```

图中的认证刷新只向 OpenAIAdapter 提供有效令牌；没有指向 Qwen。公共协议层负责编码与解析，实际 HTTP 连接由各 Adapter 持有。流程不增加新的 Agent Loop。

### 4. Qwen 提取保持当前行为

- 将现有 qwen/request.ts 与 qwen/sse.ts 的协议职责迁入 completions；SSE 字节解码、分帧、事件预算与 reader 释放提取到共享 sse.ts，由两种协议实际使用。
- chat_template_kwargs.enable_thinking 留在 Qwen Adapter。现有 reasoning 输入/输出字段与缺少远端工具 ID 时的生成策略，由 Qwen 指定明确的转换选项；公共协议代码不识别 qwen provider 名称。
- 只为现有行为保留必要选项，不创建任意字段映射、插件式 converter、兼容配置矩阵或基类体系。标准协议不包含的厂商行为不能被宣称为默认通用行为。
- 当前已接受的 reasoning 字段、max_tokens、工具参数原文、finish、usage、大小边界、取消和失败保持一致。移除已迁出的 qwen 子目录文件，同时更新生产导入、测试导入、公共出口和当前文档，用 rg 检查旧路径无残留。
- 不把结构提取和新支持更多兼容服务器混为同一步；“公共协议可复用”不等于“已验收所有 OpenAI-compatible 服务”。

### 5. Responses 多轮历史与 replay

当前 ModelEvent / ContentBlock 主要保留正文、reasoning 文本和工具 id/name/arguments。Responses 的 encrypted reasoning、输出 item ID、文本 phase、工具 namespace 等不能只保存在 Adapter 内存中，也不能混入给模型看的普通文本。

采用随成功助手消息保存的不透明、可序列化 replay envelope。通用层只认识版本/来源边界以及与内容的对应关系，不解析供应商内部 payload；Responses 协议负责校验与恢复其原生信息。这里的 signature / encrypted_content 是服务端返回的协议数据，不是为普通文件新增签名或哈希。

ModelEvent 成功终态携带 replay；collect / accumulator 保持它与最终内容对齐；src/agent/request.ts 将其带入助手消息；既有 assistant-message 事件与 Session 投影保存它；下次 Responses 请求恢复原生 item。过滤残缺块时同步处理对应 replay，不能保留指向已删除工具的元数据。

无可见摘要的 reasoning item 也必须有明确保留位置，不因未显示文字而丢失。协议内部信息不新增桌面可见内容类型、不进入既有 RPC 展示事件。当前只验收固定 provider/model 的会话；跨供应商或跨模型原生 replay 的迁移不在本轮支持范围，不把其他来源的元数据原样回传。

HTTP 使用 store:false、stream:true，每次带完整所需历史，不依赖 previous_response_id。system 信息转换为 instructions / developer，保留当前提示词与上下文更新的顺序。固定 navo 工具 namespace，在协议边界转换一次名称与回传字段；Runtime 继续看到原工具注册名，call_id 与工具结果严格对应。

### 6. 认证、配置与错误语义

- 本机稳定 host ID；首次动态注册，后续复用发行 client_id；随机 state、nonce、PKCE，先监听 127.0.0.1 回调再打开系统浏览器。回调 port 可选可用端口，路径固定，不绕过身份与 permission 验证。
- 验证 ID token 签名、issuer、audience、expiry、nonce 以及 chatgpt.tokens.use.direct scope。每个账号注册分开保存；第一版可只有一个活动账号，底层记录不以邮件作为唯一键，不混用注册和令牌。
- 凭据与稳定 host ID 保存于 NAVO_HOME 的 auth 区域，与项目事件分离；采用本地原子写入与受保护文件访问，Windows 验收实际 ACL，不能把 Unix mode 当成 Windows 保护证明。令牌不进入 Renderer、模型请求快照、项目资源或普通日志。
- Host/CLI 对同一凭据记录的刷新串行，避免轮换 refresh token 竞态；一次刷新同时保存新 access/refresh/expiry。凭据模块不持有本轮模型 AbortController。取消等待者不误取消其他请求所共享的刷新，登录尝试自身可取消并释放回调连接。
- 认证 CLI 与 Host 使用同一存储和注册。先提供 login / logout / models，不在本轮新增登录 UI 或 RPC。登出停止使用选中凭据、按官方 discovery 的 revocation endpoint 撤销会话并清理本地令牌；临时网络问题不伪装成撤销成功。
- Host 增加 LLM_PROVIDER=qwen|openai，缺省仍为 qwen。openai 的模型由用户从账号目录选定，缺少配置时报明确错误，不沿用 Qwen 模型默认值。
- openai 不自动带 Qwen 的默认 maxTokens。若显式为订阅路线设置 maxTokens/temperature/Qwen thinking 参数，启动配置或 Adapter 报不支持，不静默忽略，也不向 API 发送。Qwen 的原配置语义保持不变。
- 复用现有模型超时、回合预算和取消，不增加额外重试或自动切换计费。订阅额度/权限拒绝使用明确终态错误，不映射成可被现有瞬时 RATE_LIMIT 策略重复请求的同一类错误。
- 只有 response.completed 且工具项完整才是成功。response.failed、response.incomplete、缺终态断流、取消分别映射，残缺工具不执行。src/agent/request.ts 现有“已展示内容后不自动重试”规则保留，同时不得让泛化断流文案覆盖额度错误的可解释信息。

官方依据：[登录规范](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)、[模型与推理](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)、[预览限制](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)、[刷新与账号管理](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)、[错误](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery)。官方预览能力仍可能变化，实施前以实时文档核对。

### 7. Harness 与 Pi 对照

DeepSeek Harness 只读官方源码快照：d743267388641bc76f17c45ce8b4c231aed1d32c。

- [llm/src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/llm/llm/src/index.ts)：统一 adapter 注册与模型流调用。Navo 保留现有接口，不引入完整模型目录、动态配置服务和扩展框架。
- [llm-deepseek/src/adapter.ts](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/llm/llm-deepseek/src/adapter.ts)：Adapter 组合 serialize、parseSse、translate，并拥有认证、请求取消和消费结束后的连接清理。采用职责与生命周期，不引入文件上传、降级分支、native Messages API、请求扩展及额外 watchdog；Navo 已有模型 deadline。
- [llm/src/types.ts](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/llm/llm/src/types.ts) 与 [assembler.ts](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/llm/llm/src/assembler.ts)：成功 finish 携带不透明 ReplayEnvelope，聚合时同步裁剪内容与块元数据。采用这个职责边界，不照搬未知值宽泛接口、全部 source 联合类型或跨 Adapter 路由体系。
- [llm-deepseek/src/replay.ts](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/llm/llm-deepseek/src/replay.ts)：协议 owner 校验版本、模型、块数和块类型。Navo 在 Responses 协议内校验，不引入自动降级和通用 fallback。
- Pi 使用此前记录的 commit 7d75a0e3eb273dff753d49c066ea29fbe7b3b6f6，借鉴 ChatGPT OAuth、Responses 多轮回传与终态处理；不复制其旧 Codex backend-api、每次重新注册或不完整 ID-token 校验。详见 [85](85-devlog-chatgpt-provider-research.md)。

公共协议目录是针对 Navo 的选择，不声称 Harness 已采用相同目录结构。Harness 当前直接 DeepSeek Adapter 已使用 Messages transport，本方案的 Chat Completions 提取依据是 Navo 现有 Qwen 实现。

## 候选步骤与验收

步骤代号 M1.1–M1.4 暂用于本轮模型接入，确认后登记为补充后端工作，不占用 F10 持久化编号。分支遵循 phase10-m1.1-protocols 等项目约定，每一步独立 PR；若阶段编号在开始前变化，以最新所属阶段为准。

| 候选 Step | 用户获得的能力 | 完成标准 |
|---|---|---|
| M1.1 现有模型接入可复用的协议基础 | Qwen 继续正常工作，后续 Chat Completions 接入可直接复用消息、工具和流解析能力 | 原 Qwen 请求、事件、thinking、错误和取消断言保持；共享协议测试覆盖真实现有行为；旧路径无引用；完整本机检查与 CI 通过 |
| M1.2 新协议下的连续对话与工具往返 | 系统能正确理解 Responses 输出，并在下一次请求中带回足够的历史与工具结果 | 离线完整 Responses fixture 验证正文、reasoning、工具往返、隐藏 replay、usage、失败、断流和取消；重建 Adapter 后同一 Session 仍能续接；不依赖网络或 Adapter 会话缓存 |
| M1.3 本机订阅授权与账号模型查询 | 用户可独立登录 ChatGPT、查看自己的模型、刷新凭据及登出 | OAuth/OIDC、scope、回调取消、文件权限、轮换刷新竞态测试通过；真实账号登录/模型目录/撤销结果明确记录；账号未获准时记录失败，不标成功 |
| M1.4 Navo 使用订阅模型完成工作 | 用户可通过配置选择 OpenAI 订阅，普通对话及现有工具闭环使用所选模型 | Host 与现有桌面启动链正确装配；真实文本、只读工具→模型续接、取消、重启后凭据复用与刷新通过；Qwen 回归通过；额度失败的离线验证通过且不切计费；完整本机检查与 CI 通过 |

M1.2 不声称已经完成真实 OpenAI 接入，M1.3 不声称已可执行 Navo Turn，M1.4 不声称新建了登录设置页面。Session 的进程重启恢复仍属于 F10.2；这里只保证凭据恢复，不能把“重启后可登录调用”当作“重启后旧会话可继续”。

正式计划只登记上表功能目标、职责范围与验收，不把此文的文件/实现清单复制进计划。每步完成另写简短开发记录、更新索引与计划，满足本机和 CI 门禁后再按授权流程合并。

## 坑与发现

- 当前 package.json 的 license 是 UNLICENSED、private 是 true；GitHub 仓库公开不等同已有开源许可。package private 控制 npm 发布，与 GitHub 可见性不同。当前官方说明也支持本机个人项目，不能据许可证字段断言本机接入被拒；M1.3 已验证本次账号准入。不修改许可证、不冒用 Pi 客户端、不借用既有 Codex token。
- 当前 Agent 把流中已展示内容后的失败概括为 stream-output-interrupted；订阅额度错误需要在这条实际路径保留可解释信息，同时不能破坏禁止自动重放已展示内容的规则。
- 后端内部 replay 必须与 Session 消息一起传递；将其放进全局 Map、Adapter 私有缓存或普通 reasoning 文本都不能证明多轮历史正确。
- 通用 SSE 解帧只承担字节与 framing，不承载两种协议的完成判据和工具状态机；两种协议各自解析其 payload。

## 下一步与范围边界

M1.1、M1.2 已合入 master，四个补充步骤已纳入 backend-plan.md。M1.2 最终经用户确认合入 PR #51（c27dd34）。M1.3 已获授权实施，真实账号验收通过，等待合入验收；F10 持久化主线不被替换，M1.4 不提前实现。

本轮方案不包含 OpenAI API key 计费、旧 Codex backend-api、其他新厂商、通用配置平台、运行中切换模型、跨模型 replay 迁移、图像/音频/文件上传、自动 fallback、Pi/Codex Agent Loop、Session 持久化或新的前端设置 UI。前端登录/模型选择若后续需要，先分别规划后端公共契约与前端消费。

真实订阅推理验收预计 5–15 分钟，影响范围为所选账号的共享额度以及指定测试 Session；工具只读，不运行 GPU 实验、不写项目工作区。真实 OAuth/账号查询预计 2–5 分钟，改变账号授权及本机凭据但不执行推理。实施时先报告实际命令和范围、取得对应授权，再执行，不在此次写方案时发起登录或模型请求。

本轮验证仅核对本地文档引用、编号及 diff 格式；未执行代码测试或真实账号验收，未提交、推送、合并。
