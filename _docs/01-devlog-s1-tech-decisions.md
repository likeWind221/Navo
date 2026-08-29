# S1 开发记录 — 调研：技术决策

**日期：** 2026-08-29
**对应步骤：** plan.md Phase 0 / S1

## 做了什么

只调研、不接入。三个结论：

1. **运行时确认：Python 3.12.13**（本机 `python`），满足 3.11+ / asyncio，CLAUDE.md 工程约定一条成立，无需修订。
2. **本环境 LLM 通道只有一条：局域网网关**
   - 端点：`http://192.168.99.2:8090`（vLLM 0.27.1）
   - **两种格式都实测可用**：Anthropic `/v1/messages`（返回 thinking + text 块）与 OpenAI `/v1/chat/completions`
   - 鉴权：静态 token `local-gateway`（环境变量 `ANTHROPIC_AUTH_TOKEN`，见 `~/.claude/settings.json`）
   - 模型仅 2 个：`qwen3.8-27b`（128K）、`ornith-1.5-35b-a3b`（128K），均输出 reasoning 内容
   - **没有** Anthropic/OpenAI 云端 key，也没有其他 MCP LLM 通道
3. **依赖面**：`anthropic` / `openai` SDK 均未安装；`httpx 0.28.1` 可用 → P1.1 用手撕 HTTP 客户端（httpx）实现 GatewayAdapter，贴合"不引框架"原则。

> **补充（同日）：** 语言选择经用户确认为 **Python 3.12**（此前只是 S1 的遗留待决事项，调研时差点当成既定决策）；测试改用**标准库 unittest**，不装 pytest。CLAUDE.md 工程约定已同步修订。

## 关键决策（`LLMAdapter` 接口草案）

```python
# skillworld/llm.py（P1.1 落地，S1 只留草案）
@dataclass
class LLMResult:
    text: str                 # 仅取 text 块，thinking 丢弃（见坑 1）
    usage: dict               # input/output tokens

class LLMAdapter(Protocol):
    async def complete(self, messages: list[dict],
                       system: str | None = None,
                       json_schema: dict | None = None) -> LLMResult: ...
```

- **P0（S3）用 `MockLLM`**：规则式、确定性，实现同一 Protocol；
- **P1.1 加 `GatewayLLM`**：httpx POST `/v1/messages`（Anthropic 格式，响应更规整），`base_url` / `token` / `model` 从环境变量读取（`LLM_BASE_URL` / `LLM_TOKEN` / `LLM_MODEL`，缺省回落到 `ANTHROPIC_*`）；
- 统一入口 `complete(messages, system, json_schema)`：`json_schema` 非空时在 system 中注入"必须输出符合该 schema 的 JSON"指令（vLLM 不保证原生 structured output，P1.3 靠校验器 + 重试兜底）。

## 坑与发现

1. **reasoning 吃 token 预算**：OpenAI 通道测试中 32 的 max_tokens 全被 reasoning 消耗，`message.content` 返回 `null`。→ 调用时 max_tokens 要留足（建议 ≥1024），且解析必须容错 content 为 null / 取 `content[0].text` 两种形态。
2. 网关的 `/v1/models` 是 OpenAI 风格，`/v1/messages` 却是 Anthropic 风格——**别假设一种协议贯穿所有端点**，以实际探测为准。
3. 静态 token 写在用户全局 settings.json 里，非敏感；代码里只从环境变量读，不落盘。

## 下一步

S2：`skillworld/graph.py` 数据模型 + DAG 核心（拓扑取序 / 后继解锁 / 环检测）。
