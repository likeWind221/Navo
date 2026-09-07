# 阶段 7：Fetch 网页读取与调研闭环

> 整合 Step 7.0–7.9，以提交 `294d624` 的最终行为为准。早期截断方案已由完整正文契约替代；附录保留各步原始记录作为历史，不能用其中旧行为指导当前开发。

## 最终契约与架构

NodeAgent 已打通 `web_search → web_fetch → 教材/练习题提交 → 再次调研与修改`。Fetch 结果进入 SessionLog 和下一次模型请求，NodeEvent 只记录领域工具提交的最终内容。

- Search 已删除 `ctx.search` 与动态 Adapter 注册表，改由 SearchTool 构造时注入单个 Adapter。
- Tools 根只公开 `ctx.tools`。FetchCore 是内部普通对象，不继承 Cordis Service，不增加公开 Fetch Adapter 或 `ctx.webFetch`。
- 模型只提交 URL；结果包含最终 URL、HTTP 状态与 HTML 或 Markdown/纯文本正文。可信配置控制网络策略、超时和预算。
- 传输、解码、Core 正文、HTML 转换及最终模型输出必须全部满足预算；超限返回 `response-too-large`，不返回残缺前缀，不再提供 `truncated` 字段。
- HTML 转为 Markdown，清除脚本、样式、嵌入对象与隐藏节点，输出标记为不可信外部数据。PDF、二进制媒体、浏览器渲染和登录态不在本阶段范围内。

## 安全与生命周期

URL 限 HTTP(S)，拒绝嵌入凭据；校验 IPv4、IPv6、映射地址及 NAT64 目标。完整 DNS 答案中出现非公网地址即拒绝，实际连接固定已验证地址，同时保留原 Host/TLS SNI。每跳重定向重新校验 URL、同源性和 DNS；不读取 Cookie、Authorization 或环境认证。

默认响应上限 5 MiB、解码/Core 正文 100,000 字符、模型输出 60,000 字符、同源重定向最多 5 跳。恰好达到字节预算时仍需确认 EOF；额外字节导致失败。HTML 转换可能膨胀，因此转换结果和最终输出都需限制。

FetchCore 每次调用独立拥有 AbortController、deadline、timer 与监听器；默认超时 30 秒，配置最大 5 分钟。预取消不启动底层调用，超时/取消后拒收迟到结果并处理迟到 rejection。HTTP 在所有退出路径释放 Body 与私有 Dispatcher；工具卸载取消在途工作。协作取消不等于强停不合作实现。

FetchError 将固定 modelMessage 与内部诊断/cause 分离。Mock 仅替换底层读取，仍经过真实 Core 校验、冻结、超时和取消。Node 白名单扩展时，细粒度 NodeSession 测试也必须安装相应 Mock 工具。

## 步骤与验收

| 步骤 | 交付 |
|---|---|
| 7.0 | Search 边界收缩 |
| 7.1–7.2 | Fetch 协议、稳定错误、校验与执行边界 |
| 7.3–7.4 | URL/IP/DNS 策略、固定连接、HTTP 与有界响应 |
| 7.5–7.7 | Mock、HTML 转换、FetchTool、Tools 根与 Node 接入 |
| 7.8.1–7.8.2 | Core/网络/HTTP/工具安全测试 |
| 7.9 调研收口 | 公开入口调研闭环、显式真实网络冒烟 |
| 7.9 完整正文补强 | 废弃截断，补充各层超限失败断言 |

历史计划将调研收口与完整正文补强均编号为 7.9，此处用名称区分。最终历史验收为 Fetch 专项 5 个文件、29 项测试，全项目 28 个文件、198 项测试，typecheck 与 build 通过；早期记录的 28/197 项是补强前计数。本次文档合并未重跑代码测试。

真实 `https://example.com` 冒烟被 `blocked-url` 拒绝，未绕过 DNS/代理返回非公网地址的安全规则。公网成功仍需在兼容固定目标校验的环境复验。提交 `294d624` 的 Codex 审查未发现需要修复的具体问题。

## 下一步

按 [阶段 8 规划](21-devlog-phase-8-file-tools-plan.md) 进入 8.1 文件工具协议与错误：确定 `read/find/write/edit` 输入、分页结果、Session 相对路径和稳定错误。后续实现受控 IO、工具注册与 Fetch spill。NodeAgent 默认仅获得 `read/find`，教材和题集仍通过领域工具修改。

spill 只能保存已经完整取得的正文，不能恢复 HTTP 层拒绝或截断的数据。无状态批改、Attempt/Evidence/Verification、Main Agent 与 DAG 已顺延为阶段 9–11。

## 附录：分步历史记录

以下内容仅用于追溯当时决策；其中“截断”“省略标记”和旧阶段编号，以本文最终契约及当前 backend-plan.md 为准。


### 原记录：41-devlog-step-7-0-search-tool-boundary.md

### Step 7.0 Search Tool 边界收缩开发记录

#### 做了什么

- 删除 `src/tools/builtins/search/service.ts` 及 `ctx.search` Cordis Service。
- SearchTool 改为在构造时接收单个 SearchAdapter 和可选超时，直接调用普通 `executeSearch` 函数。
- `executeSearch` 接管请求规范化、Adapter 校验、结果复制冻结、超时、取消和未知错误归一化。
- ToolsPlugin、Node 测试、Search 工具测试和真实 Exa 冒烟脚本改为通过 SearchTool 配置注入 Adapter。
- 原 `tests/search-service.spec.ts` 替换为 `tests/search-execution.spec.ts`，删除无实际消费者支撑的动态注册与 Provider 路由测试。

#### 关键决策

- Cordis 只暴露跨插件共享的 `ctx.tools`；具体工具不再各自暴露 Service。
- Search 的 Provider 选择由可信 Host 在构造 Adapter 时完成，不在应用 Context 内维护动态注册表。
- 未配置 Adapter 时仍注册 `web_search`，保证 Node 白名单中的工具 Schema 稳定，执行时返回固定的 Provider 不可用错误。

#### 坑与发现

- Cordis 会自动清理 `ctx.effect`，但普通插件返回函数不适合承载额外的在途取消；生命周期 AbortController 和工具注销必须放进同一个 effect 清理函数。
- 移除四类动态注册/路由场景并新增工具卸载取消场景后，完整测试由 151 项调整为 150 项，所有当前行为均通过。

#### 下一步

进入 Step 7.1，定义与 Node、Cordis 和 HTTP 实现无关的 Fetch 公共协议与安全错误。


### 原记录：43-devlog-step-7-1-fetch-protocol.md

### Step 7.1 Fetch 公共协议与错误开发记录

#### 做了什么

- 新增 `src/tools/builtins/fetch/types.ts`，定义 URL 请求、最终响应 URL、HTTP 状态、截断标记及 HTML/文本正文联合类型。
- 文本正文显式区分 Markdown 与纯文本；HTML 保持原始来源形态，留给后续工具展示层转换。
- 新增 `src/tools/builtins/fetch/errors.ts`，定义 FetchError、封闭错误码和固定模型可见消息。

#### 关键决策

- Fetch 协议不定义 Adapter、Provider 或 Cordis Service；后续由 Tools 根内部的普通 FetchCore 直接实现读取能力。
- 超时、字节上限、字符上限和重定向策略属于执行配置，不进入模型可选的 FetchRequest。
- FetchError 的内部 message/cause 可保留诊断，模型只能读取由错误码映射的固定 modelMessage。

#### 坑与发现

- Markdown 与纯文本虽然都能直接返回模型，但显式 format 能避免后续格式层重复转换或误判 HTML。
- 非 2xx 状态暂不定义为协议错误；FetchResult 保留 statusCode，具体 HTTP 实现在 7.4 确定响应接纳规则。
- 设计复审后删除了只有单实现却携带身份字段的 FetchAdapter；测试替换点收缩为 FetchCore 或其底层请求函数，不形成公开架构层。

#### 下一步

进入 Step 7.2，实现不依赖 Cordis 的 FetchCore、请求/结果校验、复制冻结、超时、取消和单次调用边界。


### 原记录：44-devlog-step-7-2-fetch-core.md

### Step 7.2 FetchCore 与校验边界开发记录

#### 做了什么

- 新增 `src/tools/builtins/fetch/core.ts`，实现不继承 Cordis Service 的内部 FetchCore。
- FetchCore 构造时接收匿名底层读取函数和可信配置，一次 `fetch()` 调用独立拥有 AbortController、deadline、timer 与监听器。
- 新增 `src/tools/builtins/fetch/validation.ts`，规范化 URL 请求，校验最终 URL、HTTP 状态和正文联合类型，并截断、复制、冻结结果。
- 未知底层异常统一收敛为不泄露 cause 的 `network-failed`；已经分类的 FetchError 保持原错误码和安全模型消息。

#### 关键决策

- 底层读取函数是 FetchCore 的匿名构造依赖，不命名为 Adapter、Provider 或 Cordis Service，也不注册 Context 属性。
- 默认超时为 30 秒，最大 5 分钟；默认正文预算为 100,000 字符，可信配置最大允许 1,000,000 字符。
- 请求与返回 URL 的基础长度上限为 2,048；HTTP(S)、内网地址和连接目标等完整网络策略继续由 7.3 负责。

#### 坑与发现

- 取消必须在请求校验和底层调用前检查，避免预取消请求启动任何外部副作用。
- 底层 Promise 即使在超时或取消后才拒绝也必须挂接处理器，避免迟到 rejection 变成未处理异常；核心只是不再接纳迟到结果，不声称能强停不合作函数。
- Markdown 和纯文本不需要 HTML 转换，但仍是不可信外部数据，协议注释已明确这一点。

#### 下一步

进入 Step 7.3，实现 URL 预检、IPv4/IPv6/NAT64 公共地址判定、完整 DNS 集校验和实际连接地址固定。


### 原记录：46-devlog-step-7-3-fetch-network-policy.md

### Step 7.3 URL 与公共网络策略开发记录

#### 做了什么

- 新增 `src/tools/builtins/fetch/policy.ts`，限制 URL 长度、HTTP(S) 协议和内嵌凭据，并提供规范化同源判断。
- 新增 `src/tools/builtins/fetch/network.ts`，校验完整 DNS 地址集、IPv4/IPv6/映射地址及 NAT64 目标，并通过 Undici 自定义 lookup 固定实际连接地址。
- DNS 等待与固定连接均贯穿 AbortSignal；请求返回独立 close()，由后续 HTTP 实现在读取或取消响应体后释放私有 Dispatcher。
- 精确加入 `ipaddr.js@2.5.0` 与 `undici@8.10.0`，保留并行 Kernel Host 已加入的根包脚本与其他依赖变更。

#### 关键决策

- 只要同一主机名的 DNS 答案中包含一个非公网或非法地址，整个目标即被拒绝，不从混合结果中挑选可用地址。
- DNS 只解析一次；实际 HTTP Host 与 TLS SNI 保留原主机名，而连接 lookup 只能返回已经验证的固定地址，防止 DNS rebinding。
- RFC 7050 发现当前网络的 DNS64 前缀，并按 RFC 6052 提取 NAT64 内嵌 IPv4；翻译后指向内网的地址同样拒绝。
- network.ts 只提供安全网络原语，不暴露 Cordis Service，也不读取 Cookie、代理凭据或环境认证。

#### 坑与发现

- WHATWG URL 的 IPv6 hostname 保留方括号，交给 IP 解析器前必须移除，固定连接时再保留 URL 原始主机语义。
- 调用方取消与 DNS 原始失败可能同时发生；错误收敛必须优先返回 aborted，避免原始 resolver 异常越过安全错误协议。
- 地址固定只能防止连接阶段再次解析；重定向的每一跳仍必须在 7.4 重新执行 URL、DNS 和同源检查。

#### 下一步

进入 Step 7.4，实现 FetchCore 使用的匿名 HTTP 读取函数、同源重定向循环、响应类型与字符集分类、有界流读取和资源释放。


### 原记录：47-devlog-step-7-4-http-fetch.md

### Step 7.4 HTTP Fetch 实现开发记录

#### 做了什么

- 新增 `http.ts`，构造 FetchCore 使用的匿名 HTTP 读取函数，逐跳重新解析并固定同源重定向目标。
- 新增 `response.ts`，分类 HTML、Markdown 与纯文本，按声明和实际字节流限制正文，并按 charset 解码和字符预算截断。

#### 关键决策

- 请求只发送固定 User-Agent 与 Accept，不读取 Cookie、Authorization 或模型请求头；跨源重定向要求新的工具调用。
- 默认响应上限 5 MiB、解码正文 100,000 字符、同源重定向 5 跳；所有路径取消 Body 并关闭私有 Dispatcher。

#### 坑与发现

- 恰好填满字节预算不代表截断，必须继续读取一次确认 EOF；只有实际丢弃字节才设置 truncated。

#### 下一步

实现确定性 Mock FetchCore。


### 原记录：48-devlog-step-7-5-mock-fetch-core.md

### Step 7.5 Mock FetchCore 开发记录

#### 做了什么

- 新增继承真实 FetchCore 的脚本化 Mock，支持结果、异常、挂起、请求记录和剩余脚本计数。

#### 关键决策

- Mock 只替换匿名底层读取函数，仍经过真实 Core 的请求校验、超时、取消、结果冻结和错误归一化。

#### 坑与发现

- 挂起脚本使用一次性 AbortSignal 监听器，不创建 timer 或系统句柄。

#### 下一步

实现 HTML 转换、输出预算和 FetchTool。


### 原记录：49-devlog-step-7-6-fetch-tool.md

### Step 7.6 HTML 转换与 FetchTool 开发记录

#### 做了什么

- 使用 Turndown 与 GFM 插件把有界 HTML 转为 Markdown，并删除脚本、样式、嵌入对象和隐藏节点。
- 注册 `web_fetch`，输出最终 URL、HTTP 状态、不可信内容声明和截断提示。

#### 关键决策

- HTML 转换前限制输入和最大 512 层嵌套，转换失败返回固定省略标记，不把原始活动标记交给模型。
- 最终模型输出默认最多 60,000 字符；工具卸载通过同一 Cordis effect 取消在途 FetchCore。

#### 坑与发现

- 网络流需要分块读取，但 HTML→Markdown 必须在有界前缀上整体解析，因为标签、列表和表格状态会跨字节块。

#### 下一步

将 FetchTool 接入 Tools 根与 Node 白名单。


### 原记录：50-devlog-step-7-7-fetch-integration.md

### Step 7.7 Tools 与 Node 接入开发记录

#### 做了什么

- ToolsPlugin 默认组合安全 HTTP FetchCore 和 FetchTool，同时允许测试传入自有 MockFetchCore。
- NodeAgent 白名单增加 `web_fetch`，Profile 要求先 Search 发现来源，再 Fetch 读取最有用页面后提交内容。

#### 关键决策

- 不新增 `ctx.webFetch`；只有公共 `ctx.tools` 对 Cordis 暴露，FetchCore 始终是 Tools 根内部对象。

#### 坑与发现

- NodeSession 单测直接组装细粒度插件，因此白名单增加工具后必须同步安装 Mock FetchTool，否则严格 Schema 选择会拒绝未知工具。

#### 下一步

验证 Core、网络、HTTP 与工具安全边界。


### 原记录：51-devlog-step-7-8-1-fetch-core-network-tests.md

### Step 7.8.1 FetchCore 与网络测试开发记录

#### 做了什么

- 新增 Core 与网络测试，覆盖请求/结果冻结、正文截断、分类错误、预取消、调用中取消、超时和迟到结果。
- 覆盖 URL、IPv4/IPv6/映射地址、NAT64、混合 DNS、DNS 取消、固定 lookup 和真实本地 Undici 连接。

#### 关键决策

- 安全网络测试不访问公网；本地服务器只用于证明固定地址连接不会重新解析 URL hostname。

#### 坑与发现

- 固定连接函数接受已经验证的地址集合，公网校验责任位于唯一调用路径 `resolvePublicAddresses`。

#### 下一步

验证 HTTP 响应与模型工具输出。


### 原记录：52-devlog-step-7-8-2-fetch-http-tool-tests.md

### Step 7.8.2 HTTP 与工具测试开发记录

#### 做了什么

- 新增 HTTP 测试，覆盖三类文本、非 UTF-8 charset、二进制拒绝、声明/流式超限及同源、跨源和超额重定向。
- 新增工具测试，覆盖 Schema、HTML 清理、Markdown 输出预算、白名单、安全错误和卸载取消。

#### 关键决策

- HTTP 测试替换内部网络方法并使用真实 Undici Response，不依赖公网或代理状态。

#### 坑与发现

- 工具生命周期取消与调用方信号含义不同；卸载需要收敛在途工作并返回固定取消文本，但不伪装成用户主动取消。

#### 下一步

完成公开入口调研闭环验收。


### 原记录：59-devlog-step-7-9-complete-fetch.md

### Step 7.9 Harness 风格完整正文语义开发记录

#### 做了什么

- `web_fetch` 不再返回任何截断前缀；响应字节、解码文本、Core 正文、HTML 转换结果或模型输出超过预算时，统一返回 `response-too-large`。
- 删除 Fetch 结果中的 `truncated` 状态；只有完整 HTML、Markdown 或纯文本才能到达 Agent，上游网页无法完整保留时不制造残缺结果。
- 补充传输流、解码文本、Core 校验和工具输出的超限测试，并保留 Search→Fetch→Node 内容的集成验证。

#### 关键决策

- 对齐 DeepSeek Harness 的“一次 Fetch 获取正文”职责边界，但不在本 Step 复制其通用工具结果 spill；Harness 的 spill 只能读取 Fetch 已取得的结果，也不能恢复 Provider 已截断的网页内容。
- `spill + read` 延后为独立阶段：它需要临时结果存储、生命周期清理、访问授权和受控 offset/limit 协议，不能作为 Fetch 超限时的隐式副作用。

#### 坑与发现

- HTTP 的 `Content-Length` 可能缺失，因此流式读取必须在恰好达到预算后继续读到 EOF；一旦收到额外字节立即取消并报超限，不能返回已收集前缀。
- HTML 转 Markdown 后可能比源文本更长，因此最终模型输出预算也必须作为完整文档门槛检查。

#### 下一步

后端进入阶段 8 无状态练习批改 MVP；出现真实长工具结果阅读需求后，再单独设计 Harness 风格的 spill 与 `read`。
