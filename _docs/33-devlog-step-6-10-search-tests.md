# Step 6.10 搜索测试开发记录

## 做了什么

- 新增 Search Service 离线行为测试，覆盖注册、确定性路由、输入输出校验、不可变快照、取消、超时和卸载。
- 新增 Exa HTTP Adapter 协议测试，覆盖认证与请求体、响应映射、重定向、类型与 JSON 校验、5 MiB 限制、安全错误和取消。
- 新增 `web_search` 工具闭环测试，覆盖 Schema、Turn 白名单、安全输出、字符预算、Runtime 二次模型请求和 Node 领域隔离。

## 关键决策

- 所有 Provider 和 HTTP 行为均用确定性 Mock 验证，不读取真实密钥、不访问真实网络。
- 保持 Search、Tool 与 Node 三层边界：搜索只返回不可信资料，工具只格式化模型输入，不写 NodeEvent。
- 沿用 Harness 的 Provider 注册、显式选择、取消传播和工具闭环职责，但保留当前单查询、固定安全模型消息与内建超时的简化协议。

## 坑与发现

- Cordis 插件读取 `ctx.search` 必须声明 `inject: ["search"]`，否则插件 Fiber 会拒绝未声明的 Service 访问。
- 输出预算测试必须经过 Search Service 的单来源长度限制，再用多来源触发工具层总字符预算。

## 下一步

进入 Step 6.11，定义确定性的 NodeAgent Profile，并限制其只能访问当前 Node 快照与获准工具。
