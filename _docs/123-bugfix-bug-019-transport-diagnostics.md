# BUG-019：模型连接失败缺少可持久化的底层诊断

> 日期：2026-10-18；状态：仅排查，未修复；跟踪：[bug-plan.md](bug-plan.md)
> 关联：[121：F12.7 两轮真实失败](121-bugfix-bug-017-review-evidence.md)

## 现象与复现

用户授权排查连续两轮 TRANSPORT，不授权新增模型复验或网络配置变更。两轮分别在 17:58:43（Node B，全局第 24 次请求）及 18:08:48（Node A，第 11 次请求）失败。Session 仅保留 TRANSPORT / OpenAI Responses request could not be reached，无法从数据库区分 TCP 超时、TLS、连接重置等情况。

## 已证实事实与根因边界

### Navo 错误路径

src/llm/adapters/openai.ts 的 fetch 异常分支在尚未取得 HTTP Response 时抛出该固定消息，并保留 Error.cause；signal 已取消时会走不同路径。HTTP 非成功状态由 httpFailure 处理，SSE 错误另有消息。因此这两轮不是已收到的 429 / 401，也不是报告为 Responses SSE 的事件解析或流中断。

src/llm/service.ts 的 normalizeFailure 对 LLMProviderError 只复制 code、message、status、retryAfterMs，没有传递底层 cause。scripts/compaction/request.ts 的失败记录也只保存 error.message。诊断信息在对象内存在，但没有进入持久化现场；旧数据库不能恢复已经丢失的异常对象。这是 BUG-019 已确认的排障缺口，与 BUG-017 的审查材料入口不同。

### 第一轮：代理服务器连接超时已找到对应证据

实际路径为 Node 24.19.0 --use-env-proxy → HTTP(S)_PROXY=http://127.0.0.1:7897 → Mihomo → AI网站分组 / 美国圣何塞04 → api.openai.com:443。NO_PROXY 只含本机地址，未绕过该目标；7897 由 Mihomo PID 25092 监听。

C:/Users/likeW/AppData/Roaming/mihomo-party/logs/core-2026-10-18.log 在 17:58:43.041183100+08:00 记录：node.exe 请求 api.openai.com:443，经 AI网站分组连接 pq.us04.yydjc.top:443，dial tcp 142.202.241.186:443 与 142.202.241.178:443 均 i/o timeout。验收适配器在 UTC 09:58:43.044Z（本地 17:58:43.044）记录请求失败。两者时刻相差约 3ms，提供了直接的同目标、同进程、同时间关联。

可确认该次请求失败点是本机 Mihomo 到代理服务器的 TCP 连接阶段；不是 Node 计算或压缩算法失败，也不能归因于 OpenAI 返回业务错误。此证据不能进一步证明是代理服务器、到服务器的网络还是中间设备导致超时。

### 第二轮：同一代理路径，底层原因仍未证实

18:08:47.214 与 18:08:48.115 的日志均记录 node.exe → api.openai.com 经同一分组和节点，但附近没有相同的节点连接超时告警。不能用第一轮的 timeout 直接替代第二轮根因；连接重置、TLS 或短时链路异常仍只是候选，旧 cause 已丢失。

### 当前路径及无模型探测

18:18–18:19，用与验收相同的 Node 和 --use-env-proxy，连续六次向同一 /v1/responses 端点发无认证空对象 POST，均返回预期 401；耗时 346–1905ms，Undici request:error 订阅未记录错误。没有发送 Token、未生成内容、未产生模型推理请求。原始结果：C:/Users/likeW/AppData/Local/Temp/navo-transport-probe-1792318739573.json。

curl 绕过 HTTP 代理与显式经 7897 两条路径均收到 401，约 1.26s / 1.05s。TUN 开启且 api.openai.com 解析为 198.19.0.88，Find-NetRoute 命中 Mihomo；core 日志证明前者仍经 TUN 命中同一 AI 分组。因此这不是“直连对比代理”的独立出口试验，不能据此建议关闭环境代理或认定 fake-IP 冲突。

当前 fake-IP 范围为 198.19.0.1/16、TUN 开启、rule 模式；aTrust 进程存在，但未发现其接管这两次 API 请求的证据，不因两个程序同时运行而判定 VPN 冲突。

代理关联摘要：C:/Users/likeW/AppData/Local/Temp/navo-transport-path-1792318796869.json。当前成功只证明探测时可达，不证明较长、有认证的大请求持续可靠或完整模型验收成功。

## 修复内容

仅排查，未修改代码、代理选择、DNS、TUN、VPN、证书校验、重试或 Agent 配置。未进行新模型调用，未重新打开失败 App / 数据库写入状态，旧两轮证据均保留。

## 验证与实际边界

代码检查与配置/日志对照、六次无认证 Node 探测、两条 curl 路径对照均已完成。没有验证其他代理节点，没有证明第二轮 TCP/TLS 的具体错误，也没有复验 F12.7。本次只更新文档，不重复运行本机完整测试。

参考 [OpenAI 连接错误说明](https://developers.openai.com/api/docs/guides/error-codes)：连接错误与返回 HTTP 状态的 API 错误应区分；本次具体代理超时归因来自本地日志，不由官方通用说明推定。

## 后续建议（未实施）

1. 经用户授权后，仅为当前 AI 分组选择经验证的更稳定代理节点，再做不生成内容的连通检查；不默认全局切换、关闭 TUN 或绕过证书验证。
2. 给连接失败保留有限、安全的底层分类，例如允许列表内的 code / errno / syscall / 错误阶段；分别处理内层 cause 或 AggregateError。不直接序列化完整 Error、Headers、请求体、Token 或代理 URL 凭据，也不把内部诊断注入模型上下文。具体契约需先形成修复设计，再实施。
3. 以上不自动授权再跑模型、改网络或增加重试。BUG-019 保持未勾选；后续用户授权的 18:24 运行已完成 BUG-017 的两 Node / Main 验收，见 [121](121-bugfix-bug-017-review-evidence.md)。该次成功未补齐本项底层诊断能力。
