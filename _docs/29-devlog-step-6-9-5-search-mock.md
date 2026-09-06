# Step 6.9.5 确定性 Mock Search Adapter

## 做了什么

- 新增 `src/tools/builtins/search/adapters/mock.ts`，提供 MockSearchAdapter 与 result/error/hang 三类脚本，空结果使用 sources 为空的 result 表达。
- 暴露冻结请求记录和剩余条目数；按调用顺序消费脚本，不按完成顺序分配结果。
- 更新后端计划和索引，本次串行使用最大编号 28 之后的 29，不修改前端记录。

## 关键决策

- 参考 Harness `packages/web/web/tests/web.spec.ts` 的 makeSearchProvider 协议替身，而非不存在的生产 Mock 模块；结合本项目 MockLLMAdapter 增加队列、记录和合作取消，不引入 Harness available 探测。
- 使用游标消费，单次取脚本 O(1)，预取消不记录、不消费；调用中取消已占用脚本，不回滚；脚本耗尽记录此次请求，但不递增游标。
- 构造时复制冻结脚本结果及来源；请求也复制冻结；注入 error 保留对象身份，便于断言，不克隆或冻结外部异常对象。
- Mock 不调用 Service 的归一化/裁剪，保留超额结果以验证真实服务边界；ID 校验仍由注册服务负责。
- 不新增 Mock 专属错误类，耗尽使用 SearchError(request-failed) 加明确内部诊断，取消使用 aborted；注入的错误原样抛出，交 Service 统一处理。
- hang 接受信号时挂一个一次性监听器，取消时移除并拒绝；无信号时故意保持 pending，但不创建 timer 或系统句柄。经 SearchService 调用总会传入执行信号，由 Service 负责超时；Mock 不另设时钟。
- 不提供自定义 handler、延迟、HTTP、SDK 或自动注册，不进入默认应用组合。

## 坑与发现

- 保存请求数组副本不等于快照，条目本身也需复制冻结；脚本在构造后被调用方修改也不能改变结果。
- 临时离线冒烟通过：结果/空结果/原样错误、构造快照、记录快照、预取消、等待取消与监听器清理、耗尽、并发调用分配、Service 超时后继续、默认参数及超额裁剪。
- `pnpm typecheck` 通过，`pnpm test` 15 文件/110 测试通过；临时脚本执行后删除，持久行为测试留给 6.10。

## 下一步

- 人工审查后进入 6.9.6，核实现行 Exa HTTP 协议再实现真实搜索 Adapter；Fetch 仍在阶段 7。
