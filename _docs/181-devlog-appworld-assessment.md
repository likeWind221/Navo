# AppWorld 接入核查

日期：2026-10-28。仅静态调研与源码核查；未安装、下载数据、启动服务或调用模型。

## 做了什么

核对 AppWorld 官方 README、environment.py、serve/environment.py、task.py、pyproject.toml、终端 Agent 指南；核对 Navo ToolService、Node Profile / Session、ProjectRuntime 和 Runtime 限制。确认可通过 HTTP 环境接口接入，不依赖 Research Workspace 或 GUI。当前版本 main 显示 0.2.0.dev0，实施须先固定发布版/commit及对应数据版本，不能把 main 当稳定接口。

## 关键决策

建议首版用一个 appworld_execute(code: string) 工具转发官方 /execute，代码中的 apis.api_docs 查询文档、业务 API 读写和 supervisor.complete_task 沿用官方机制。可信运行器独占 initialize/save/evaluate/close，task_id 和服务地址由运行器绑定，不交由模型选择。模型只能看到任务指令、监督者公开信息和 API 文档；评分源码、参考解法和测试难度不可进入提示或可读文件。AppWorld 安全检查不是宿主机隔离保证；执行环境放独立容器/VM，Navo 只连受控执行接口。

Navo tools.register 已有可复用注册与取消出口；NodeSessionService.resolveContext 使用固定 Profile，必须加可信配置的额外工具选择并在每次 resolveContext（含重启）重建。默认 Profile 不变；Main 保持规划，Node 获得执行工具；Main Review 可只读查实际工具结果。注册自定义工具不等于 Node 获得权限。无需为本次接入开发通用 MCP 客户端；大规模业务函数直接映射会遇到 Navo 支持的 JSON Schema 子集，首版不选。

流程：可信任务初始化 -> 单 Agent 基线或 Main 规划 -> Node 执行与工具反馈 -> Main Review / 返工 -> 官方环境保存与判分 -> 汇总状态测试、调用、Token、时延。模型自报 complete、Node submit、Main complete 和官方状态全部测试通过必须分别记录；只以后者计算 AppWorld 任务成功。

一个环境服务实例只有一个活动 task world，首版串行。Navo 重启与 AppWorld 环境重启是两类实验：前者可保留环境状态继续，后者涉及 Python 变量及业务状态恢复，不能仅凭 save_state 宣称完整支持。SGC 是同场景多个任务都通过的聚合，不是同一环境连续执行成功率。

## 坑与发现

官方 environment.py 在 Windows 将代码执行 timeout_seconds 默认为 None；建议使用 Linux 容器/VM，不能只依赖 TypeScript 请求 abort，取消 HTTP 不保证 Python 副作用停止。超时/取消需销毁本轮独占环境，保留现场并停止，不直接补发执行请求。

官方 HTTP 控制面和执行面在同一服务，因此需通过受限客户端或入口约束仅暴露执行能力，避免执行代码能访问判分服务；需核对网络访问与 SafetyGuard 的实际能力。当前 PATH 有 Python312 与 wsl.exe，未找到 docker 命令；未证明 WSL 发行版或 Docker 环境已可用。

## 验证结果与边界

仅静态阅读；没有真实兼容性或运行成功证据。候选首轮为 train/dev 中固定 3 题、简单循环与 Navo 各 1 次，6 次运行；每次合计最多 40 次生成、15 分钟、单次输出4096 tokens、串行、失败不重跑。预算只是方案，尚未授权执行。若平均每请求输入32k tokens，总输入约7.68M、输出最多约0.983M，按当前 Flash 峰时未缓存输入 $0.30/M 与输出 $1.20/M，估算约 $3.48；建议规划 $4 级额度，真实成本待先行连通 smoke 校准，不能当作已经实现的硬费用上限。任务上限90分钟不含安装和数据准备，无GPU。此小样本仅验收接入，不作为简历完成率。

正式报告固定版本、split、任务ID、种子、总预算、模型配置与工具模式；沿用原评分器。不把模型评分替代官方测试，不用测试判分器反馈指导返工。开发与调参仅用 train/dev，test_normal 冻结后正式测量。恢复或压缩改造另列 Navo 扩展实验。

## 下一步

仅建议开发，不开始实施：scripts/appworld.ts 和 scripts/appworld/ 下的环境客户端、运行器与结果汇总；src/node/session.ts 与 profile.ts 的可信工具扩展；相应工具范围、状态隔离、取消与假阳性测试。开发预计2–4个工作日，为静态估算，包含环境验证、适配、专项与仓库完整检查。不修改前端、生产默认白名单或扩展通用MCP。

## 来源

- https://github.com/StonyBrookNLP/appworld/blob/main/README.md
- https://github.com/StonyBrookNLP/appworld/blob/main/src/appworld/serve/environment.py
- https://github.com/StonyBrookNLP/appworld/blob/main/src/appworld/environment.py
- https://github.com/StonyBrookNLP/appworld/blob/main/guides/evaluating_terminal_agents.md
- https://github.com/StonyBrookNLP/appworld/blob/main/pyproject.toml
- https://api-docs.deepseek.com/quick_start/pricing/
