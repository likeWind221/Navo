# M1.2 Responses 连续对话与工具往返

## 做了什么

2026-10-13 用户授权 squash 合并 M1.1 PR #49，并继续由子 Agent 实施下一步。工作树复用，分支 phase10-m1.2-responses 从合并后的最新 master 349b035 创建，不从旧 M1.1 tip 延伸。

授权范围：公共 Responses 请求/流/原生历史回传、通用流聚合与 Session 助手消息传递，以及离线工具闭环与异常验收。主 Agent 独占文档、审查、完整验证与 Git 收口，子 Agent 实施 src 与直接相关 tests。具体改动与结果将在完成后补充。

## 关键决策

沿用 [86](86-devlog-model-protocol-design.md) 的单向职责。Responses 协议不负责 HTTP 认证或厂商选择；调用方提供 provider/model/tool namespace。原生回传信息随成功助手消息保存，不依赖 Adapter 缓存，不交给桌面展示事件。公共协议可表达的参数与 ChatGPT 订阅的准入限制分开，后者留给 M1.4 接入边界。

Harness 参考沿用已核对的官方快照 d743267388641bc76f17c45ce8b4c231aed1d32c：llm/src/types.ts 的 ReplayEnvelope、llm/src/assembler.ts 的同步内容裁剪与 llm-deepseek/src/replay.ts 的来源/版本/块校验。采用不透明回传与所有者校验；不采用动态提供商框架、自动降级、额外重试或 Messages transport。

## 坑与发现

原生 encrypted reasoning 即使没有可见摘要仍须保留；工具参数不完整或响应未成功时不能执行工具。Session 重启持久化与订阅认证均未在本步授权。

## 验证结果与边界

实施中，尚未验收。不调用真实模型、不读取凭据，不占用 GPU。最终验证使用 Node 24，并记录相关离线场景、本机完整检查和 PR CI。

## 下一步

完成 M1.2 代码导读、开发记录、独立 PR 与本机/CI 验证。M1.3、M1.4 不提前实现；合并按用户授权与项目规则执行。
