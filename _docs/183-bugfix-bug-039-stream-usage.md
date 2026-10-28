# BUG-039 流式 usage 为 null 导致生成中断

## 现象与复现

外置评测真实预检的 DeepSeek Flash 请求触发 TypeError，位置为 completions/stream.ts 的 parseUsage。离线构造 usage:null 的 SSE 事件复现。原始真实 SSE 未保存；预检失败后未重跑。

## 已证实事实与根因假设

共享解析器只跳过 undefined，null 被传入 parseUsage 并触发属性访问错误。DeepSeek 官方 Chat Completions 文档明确中间流块可以返回 usage:null。现有 DeepSeek 测试仅覆盖有效 usage 对象。Qwen 共用解析器，影响取决于服务实际返回。

## 修复内容

将 null 与缺失均视为当前事件无用量，保留后续有效用量；没有有效用量时不生成 usage 事件。非空无效用量仍由既有校验拒绝。新增 DeepSeek 流式中间 null 与始终缺失用量两项离线回归。

## 验证结果与边界

Windows / Node 24：pnpm typecheck 通过；DeepSeek 和 Qwen 专项 2 文件 / 19 项通过。完整测试 183 文件 / 1140 项通过（310.43 秒）；CI 与真实复验待记录。未修改外置评测代码或原失败现场。

## 后续

完整测试及 CI 通过后在已授权预算内执行一次真实预检；成功后按原计划继续测评，失败停止。真实复验未通过前 BUG 保持未关闭。
