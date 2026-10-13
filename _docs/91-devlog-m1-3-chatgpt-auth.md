# M1.3 本机订阅授权与账号模型查询

## 做了什么

2026-10-13 用户确认方案并授权实施 M1.3。独立工作树 `D:/Program/Navo-m1.3`、分支 `phase10-m1.3-chatgpt-auth` 从当时与远端一致的 master b92b13a 创建；保留原目录 F10.1c 分支中的既存修改。90 号已在原目录分配给前端规划，因此本记录使用 91。

新增 `src/llm/auth/chatgpt.ts` 及同名目录下的 flow/token/store/permissions/schema/models/types/error；新增 `scripts/chatgpt.ts` 与直接相关测试。根包增加 `pnpm chatgpt`，固定 jose 6.2.12、proper-lockfile 4.1.2 与 @types/proper-lockfile 4.1.4。未修改前端、RPC、Host 装配、Qwen 或 Responses codec。

入口命令：`pnpm chatgpt login [--new | --account ID]`、`accounts`、`models [--account ID]`、`logout [--account ID]`。账号列表只输出稳定 ID、标签、状态、邮件及订阅权限标志，不输出凭据。默认使用 `~/.navo/auth/chatgpt.json`，`NAVO_HOME` 可覆盖。

## 关键决策

- `ChatGPTAuth` 是账号生命周期入口；认证不依赖 Agent、Session 或模型流。一次登录先监听 `127.0.0.1` 的可用端口，再打开浏览器；每次独立 state/nonce/PKCE，回调路径固定 `/auth/callback`。使用 Navo 自身名称和稳定 Host ID。Ctrl+C 或五分钟期限取消登录，关闭监听及浏览器预建连接。
- 首次注册取得发行 client ID 后先保存 pending 记录；令牌交换失败不会激活账号。再次登录复用注册，不以邮件合并账号。验证 ID token 的签名、issuer、audience、expiry、nonce，检查实际授予的 `chatgpt.tokens.use.direct`；已有账号还核对已验证身份，验证失败不覆盖活动账号。并发登出或其他登录改变记录后，旧登录结果不能再次激活它。
- `ChatGPTTokens` 只处理官方 token/discovery/JWKS/revocation；jose 实施标准签名验证，不手写 JWT 算法。令牌请求错误只公开受限错误码和 HTTP 状态，不显示原始响应或授权 URL。PKCE 使用 SHA-256 是 OAuth 协议要求，不是文件完整性校验。
- `ChatGPTStore` 拥有稳定 Host ID、注册及原子文件写入。Windows 对新建 auth 目录移除继承并授予当前 SID 完全控制，读写前检查目录/文件 owner 和实际 allow ACL，owner 与 allow ACL 均只接受当前 SID、系统和管理员，拒绝其他 SID；非 Windows 使用 owner 与 0700/0600。不会修改整个 NAVO_HOME 的权限。JSON 版本与结构在持久边界校验。
- 同一账号同进程共享刷新；proper-lockfile 的跨进程锁位于受保护 auth 目录，所有读改写、刷新及登出共用锁。获得锁后重读，距离过期不足一分钟才刷新，一次保存新 access/refresh/expiry。锁争用可等待四十秒，网络操作最多三十秒；没有 HTTP 重试或自动切换计费。取消等待者只解除其等待，不取消共享刷新。刷新凭据已失效时清理令牌并记录 reauth-required。
- 登出在锁内先取消本实例该账号的目录查询，撤销后清除本地令牌，保留注册身份与 Host ID；网络或服务失败仍完成本地登出并明确 remote revocation 未确认。没有本地令牌时不声称再次确认过远端撤销。其他进程不能在本地登出后重新刷新写回凭据；其他进程已经发出的网络请求由服务端撤销约束，本步没有跨进程运行时广播。
- `models` 使用选定账号的有效令牌查询公共 `/v1/models`；校验 models/slug/visibility，显示 visibility:list 条目的名称与 slug，并保留服务端顺序。不把 API-key 目录结构当成订阅目录，不硬编码可用模型。

短文件边界复核：error.ts 是整个 ChatGPT 认证模块公开错误的定义，供各职责模块共同使用；models.ts 拥有独立目录 HTTP 请求及响应校验，与令牌交换和凭据事务的变化原因不同，保留独立文件。没有新增内部 re-export index 或解释性源码注释。

Harness 源码对照：官方快照 d743267388641bc76f17c45ce8b4c231aed1d32c 的 `packages/llm/llm-deepseek/src/adapter.ts`。采用认证解析与请求生命周期分离、取消和消费结束清理的职责；OAuth 登录与共享刷新拥有独立生命周期。未移植 Messages transport、文件上传、降级和 idle watchdog。Navo 本步尚未创建 OpenAIAdapter。

## 坑与发现

- OpenAI 当前官方说明支持本机个人项目；旧方案中 UNLICENSED 不等于开源许可的事实保留，但不能据此断言本机个人项目不能接入。真实账号准入仍须实测。
- Windows PowerShell 从 PowerShell 7 环境继承模块路径时，Get-Acl 的模块自动加载失败；改为通过 Windows PowerShell 的 .NET File/Directory.GetAccessControl 直接读取 owner 与 ACL，不修改机器配置或引入备用分支。随后实际 ACL 正常与 Everyone 放宽后的拒绝均通过。
- 默认 node 为 22.23.1，本轮显式使用 Codex bundled Node 24.19.0，符合项目 node:sqlite 与 Node >=24 要求；没有修改用户的全局运行时。
- 首轮 PR CI 在管理员运行环境中创建目录，默认 owner 为 Administrators；原实现只接受当前用户 owner，导致认证测试被拒。修正为 owner 同 ACL 一样接受当前用户、SYSTEM、Administrators，仍拒绝其他 owner/allow SID，不放宽 Everyone 的负向验收。该轮同时有一项既有文件工具取消竞态失败，未修改无关文件或断言，后续以新 head 的完整 CI 为准。
- 修订后本机全量复验出现认证及既有 Shell 超时。认证状态单测此前每次读改写均调用 PowerShell 查询权限，反复启动进程增加并行测试负载。将状态单测的重复权限读取 mock 掉，保留新建目录时的真实保护；实际目录/文件 ACL 与 Everyone 负向验收独立运行，跨进程刷新子进程仍执行真实权限检查。未修改生产权限读取或既有文件工具测试，也未跳过场景。
- 认证等待、回调接收不等于授权成功；目录可见也不等于真实推理可用。

## 验证与边界

专项测试首轮：3 文件、20 项通过（59.31 秒）。覆盖 OAuth 回调、PKCE、拒绝授权、取消释放监听、签名/issuer/audience/expiry/nonce、权限不足、未完成注册恢复、同邮件不同注册、重建凭据实例、真实 Windows ACL、双进程刷新仅一次、取消共享刷新等待者、刷新/登出竞态、失效 grant、撤销未确认、本实例查询取消、目录结构与顺序。收尾补充 pending 登录被登出后的拒绝激活测试。

`pnpm typecheck` 与 CLI 单独类型检查通过；pending 登录竞态修订后全量 94 文件/575 测试通过（82.56 秒），新增认证测试共 21 项。`git diff --check` 通过。CLI 不在现有 tsconfig include 内，使用 `pnpm exec tsc --ignoreConfig --noEmit --strict --target ES2024 --module ESNext --moduleResolution Bundler --types node scripts/chatgpt.ts` 单独检查，没有扩大既有 tsconfig。

[PR #52](https://github.com/likeWind221/Navo/pull/52) 已创建，初始代码提交 6dfce9c；首轮 CI run 38369742913 的 typecheck 通过、test 未通过（上述 Windows owner 及一项既有取消竞态），未合并。owner 与测试负载修订后，`pnpm typecheck` 及完整 `pnpm test` 通过：95 文件/576 测试、28.04 秒；认证验收共 4 文件/22 测试。实际 ACL 正负向与双进程刷新均保留。最新修订的 CI 以 [PR #52 checks](https://github.com/likeWind221/Navo/pull/52/checks) 为准，不将初始 head 的失败当成后续结论。

真实账号验收：用户在浏览器完成授权，`pnpm chatgpt login` 验证 ID token 并保存 connected/sharing:true；另一个 CLI 进程执行 `models` 成功恢复凭据并得到 7 个可见模型，顺序为 gpt-6.1-sol、gpt-6-astra、gpt-6-sol、gpt-6-luna、gpt-5.6-sol、gpt-5.6-terra、gpt-5.6-luna。`logout` 实际调用官方 revocation endpoint 得到 HTTP 200 后清除本地令牌；再运行 `accounts` 确认 signed-out、sharing:false 且没有活动账号。未调用推理。

真实只读 discovery 成功：issuer `https://auth.openai.com`，JWKS `https://auth.openai.com/.well-known/jwks.json`，撤销 `https://auth.openai.com/api/accounts/oauth/revoke`。真实 access token 尚未自然过期；轮换刷新由离线令牌 fixture 与双进程测试证明，本轮未等待真实过期或强制刷新。

未验收边界：生产 OpenAIAdapter、Host provider 选择、前端页面与真实推理留给 M1.4；Session 重启恢复留给 F10.2。代码与账号专项已交付；完成合入验收前保持 M1.3 为 🔄。

## 下一步

最新 head 的 CI 通过后交付代码导读并等待用户确认合并，再将 M1.3 标为 ✅；下一功能为 M1.4，但需单独授权。研究库已新增并回读确认 M1.3 凭据生命周期决策（想法表 rg5T4x），未覆盖原模型接入决策或项目目标。
