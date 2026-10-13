# M1.4 Navo 使用订阅模型完成工作

## 做了什么

2026-10-13 用户授权实施及真实验收，指定 GPT 6-Luna。从最新 master 74abd52 建立 D:/Program/Navo-m14、phase10-m1.4-openai；保留原目录旧 F10.1c checkout 的既存修改，M1.1–M1.3 已在远端合入。

新增 OpenAIAdapter；修改 Host 配置与装配、Agent 失败输出、Responses namespace；补充直接相关测试及 scripts/subscription.ts，scripts/real.ts 支持所选 provider。未修改 frontend、共享 RPC/IPC、登录 UI、Session 持久化或运行中模型切换。

## 关键决策

- LLM_PROVIDER 缺省 qwen；openai 要求显式 LLM_MODEL，可用 LLM_ACCOUNT_ID 指定已保存账号。NAVO_HOME 确定数据库与认证目录。OpenAI 拒绝 LLM_MAX_TOKENS、LLM_TEMPERATURE、LLM_ENABLE_THINKING、LLM_API_KEY、LLM_BASE_URL，不继承 Qwen 参数或切计费。
- Host 按配置联合类型装配 Adapter，同一模型传入普通回合及 Project Runtime。Electron 原有 frontend/electron/host/launch.ts 继承环境并启动 src/host/main.ts，源码检查无需修改前端；未声称完成 Electron UI 人工验收。
- Adapter 从 M1.3 获取有效令牌，调用公共 /v1/responses，组合 M1.2 请求与 SSE 转换。请求拥有 HTTP/消费取消，finally 清理；共享刷新不属于模型 AbortController。凭据不进入 Renderer、请求快照或日志。
- HTTP 失败保留状态、受限机器码和至多 1024 字符诊断，支持 detail 准入错误。订阅错误不映射 RATE_LIMIT/SERVER；已展示内容后的 subscription_sharing_* 保留原码与诊断，仍不自动重放。复用既有 Runtime、Session、ToolService、deadline，不新增 Agent Loop、HTTP 重试或 fallback。
- Harness 已只读核对 d743267388641bc76f17c45ce8b4c231aed1d32c 的 packages/llm/llm-deepseek/src/adapter.ts；采用请求取消、serialize/parseSse/translate 分工与结束清理，不采用 Messages transport、文件上传或额外 watchdog。

## 坑与发现

首次 HTTP 400 missing_required_parameter 指向 tools[0].description；补齐 namespace 必填描述后真实文本/read 续接通过。登记 [BUG-009](94-bugfix-bug-009-namespace.md)。首次全量唯一失败是旧 quota 断言预期泛化断流错误，更新为保留订阅码/消息。真实重启首次标记多了句号，明确脚本提示后只补验剩余重启/刷新。

## 验证与边界

bundled Node 24.19.0；pnpm typecheck 通过。独立脚本检查：pnpm exec tsc --ignoreConfig --noEmit --strict --target ES2024 --module ESNext --moduleResolution Bundler --types node scripts/subscription.ts scripts/real.ts src/tools/builtins/fetch/output/gfm.d.ts，通过。完整 pnpm test：96 文件/585 测试通过，34.35 秒。含 Qwen 回归、配置拒绝、不登录不发 HTTP、额度单次失败且不切 provider、提前退出释放 body 和取消句柄。

真实账号重新登录成功，目录确认 gpt-6-luna。LLM_PROVIDER=openai、LLM_MODEL=gpt-6-luna 后执行 pnpm exec tsx scripts/subscription.ts --refresh；标点修正后 --restart --refresh 补齐剩余场景。真实 stdio Host 文本、read package.json -> 模型续接、正文后取消、取消后新回合、新进程复用凭据，以及官方 refresh 轮换保存后新进程推理全部通过。

刷新使用现有 ChatGPTTokens.refresh 与受保护 Store 事务主动调用官方端点；不篡改过期时间，未等待自然到期。自动临期与并发刷新由 M1.3 离线测试覆盖。只读取 package.json，未执行写工具、Shell 或 GPU 实验；保持账号登录。前端 UI、其他账号/模型、旧 Session 重启恢复未验收。

本机及真实验收通过；PR/当前 head CI/合并记录待补。

## 下一步

当前 head 必需 CI 成功后按新规则直接 squash 合并，不开始下一 Step。F10 主线仍为 F10.2。
