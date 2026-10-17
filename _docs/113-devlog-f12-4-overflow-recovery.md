# F12.4 超窗恢复与重启对账

> 日期：2026-10-17  
> 状态：✅ 本机完整验证与当前 PR head CI 均通过

## 做了什么

- 新增共享超窗错误判定，将 OpenAI 的 context_length_exceeded 及 Qwen HTTP 400 响应中的明确上下文超限语义归一为 CONTEXT_WINDOW_EXCEEDED；Qwen 只读取最多 16 KiB 错误响应体，普通 HTTP 400 保持原分类。
- 在 Agent 请求链路中拦截尚未向调用方发布内容的超窗终止事件，调用 F12.3 压缩模块执行一次 overflow 强制压缩，确认压缩成功后重建请求并重试一次。
- overflow 模式允许在缺少 contextWindow 配置时尝试恢复，选择器尽量保留安全工具配对并压缩前缀；无有效选区或压缩失败时以明确失败结束。
- 启动恢复阶段先为未闭合的压缩事务追加 compaction-ended: interrupted，再执行现有 Turn 中断收尾，保证事件顺序可回放。
- 新增 OpenAI / Qwen 错误归一、超窗恢复成功 / 无进展，以及持久化恢复顺序测试。

## 关键决策

- 只在超窗错误发生且尚未发布任何模型内容时自动恢复；若流已产生内容，不重放该次模型执行，避免重复内容或不安全的副作用。
- overflow 恢复重试次数固定为一次，不消耗常规模型重试预算；第二次请求再次超窗时由现有失败路径收口。
- Qwen 错误响应采用有界读取并只使用解析后的错误语义做分类，不把原始响应体直接写入错误消息。
- OpenAI 订阅适配器不接受 maxTokens 参数，因此摘要请求对 openai 路由省略该参数，依靠预算限制摘要输入并在安装前验证实际压缩收益。
- 重启对账复用 F10.3 的事务提交和 Turn 收尾流程；已提交 checkpoint 不会被重复应用。

## 坑与发现

- Qwen 适配器此前在解析 HTTP 错误体之前就取消响应，无法根据错误正文区分上下文超限与普通请求错误。
- F12.3 的压缩事务校验原先只允许 trigger: pressure，需要同步扩展事件类型与历史运行时校验，否则 overflow 事务不能安全落盘和回放。
- 在没有把 `C:\Windows\System32` 放在 PATH 最前时，`tests/llm/auth/permissions.spec.ts` 与 `tests/llm/auth/session.spec.ts` 共 12 项失败：Git Bash 的 `/usr/bin/whoami.exe` 遮蔽了 Windows 自带 `whoami.exe`，权限探针拿不到 SID。在 master 上复跑同样失败，属于本机 shell 环境问题，与 F12.4 无关；调整 PATH 后 12 项全部通过。
- 本机验证结果：`pnpm typecheck` 通过；`pnpm test` 在 Git Bash 中先执行 `export PATH="/c/Windows/System32:$PATH"` 后 117 个测试文件、731 项测试全部通过。GitHub Actions 的 `verify` 检查在同一分支 head 通过。

## 下一步

- 合并 F12.4 后，Phase 12 的下一步为 F12.5 压缩与上下文压力公共契约，须等用户确认后再开始。
