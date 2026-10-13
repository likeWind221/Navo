# BUG-009 Responses namespace 缺少 description

## 现象与复现

2026-10-13、Windows、Node 24.19.0、gpt-6-luna。M1.4 stdio Host 文本请求携带现有工具 Schema，公共 Responses 返回 HTTP 400 missing_required_parameter：Missing required parameter: 'tools[0].description'。

## 事实与假设

确认 src/llm/protocols/responses/request.ts 的 namespace 只有 type/name/tools。服务端明确指出缺失字段，补齐后同一装配文本和 read 续接成功，根因置信度高。M1.2 离线 fixture 未核对该必填规则。

## 修复

namespace 增加 description: Tools executed locally by Navo.，协议回归断言该字段。工具名、namespace、call_id 和 replay 不变。HTTP 失败保留机器码与受限诊断。作为 M1.4 集成必需的最小协议补齐随 Step 串行交付。

## 验证与边界

真实文本、read package.json -> 工具回传 -> 回答通过；取消、重启凭据复用、主动刷新后推理通过。本机 pnpm typecheck 和完整 96 文件/585 测试通过。未验证其他账号/模型。

关闭条件为不再因 description 拒绝、真实文本/read 续接通过、协议回归与本机/当前 head CI 通过。全部关闭条件已满足，PR #54 的 head fb9b179 经必需 verify CI 38375378364 通过并 squash 合入 master 849a126；状态见 [Bug 表](bug-plan.md)。

## 后续

2026-10-13 17:20:52（北京时间），[PR #54](https://github.com/likeWind221/Navo/pull/54) 已合入，BUG-009 关闭；不扩大协议范围。
