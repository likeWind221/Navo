# Step 6.9.1–6.9.3 搜索协议、错误与注册服务

## 做了什么

- 新增 `src/tools/builtins/search/{types,errors,service}.ts`：提供商无关协议、本地错误、安全模型消息及 Cordis 注册/路由服务。
- 后端计划展开 6.9.1–6.9.7 和 6.10.1–6.10.3，本次仅完成前三个子步骤；不修改前端和应用组合。
- 本次由后端串行登记索引，使用现有最大编号 25 之后的 26，合并记录三步。

## 关键决策

- `registerAdapter(adapter)` 使用稳定 ID；ID 为 1–64 位小写字母开头的小写字母、数字或连字符，不静默 trim。显式默认缺失即失败；未配置默认时只能选择唯一注册项。
- 参考只读 Harness `packages/web/web/src/{types,index}.ts` 的能力接口、确定性路由与调用 fiber 所有的 effect；使用当前上游 Cordis 的实际 API 验证卸载。
- 不采用 Harness 的 search/fetch 合并、动态 available 探测、环境变量回退或生成式 answer 字段：当前只有搜索，配置有效后才注册，运行时认证失败未来作为请求错误，不自动换厂商。
- Pi `web-access` 的工具/核心/Provider 分层值得借鉴，但其核心静态分支和 Pi 凭证依赖不进入本服务；本服务仅依赖公共 Adapter 协议。
- `SearchResult.sources` 允许空数组；标题、URL、摘要必需，发布时间可选；readonly 只是类型约束，运行时校验、复制冻结在 6.9.4。
- `SearchError.modelMessage` 仅由固定错误码映射，不复制内部 message/cause；保留 aborted 与 timeout 区别。错误对象本身不承诺可序列化或可安全直接日志输出。
- 注册撤销随调用插件卸载，手动撤销幂等；注册不等于模型授权，同进程插件也不是沙箱。resolveAdapter 是可信后端路由 API，不是模型参数。

## 坑与发现

- Cordis 插件需等待激活：首次临时冒烟未 await 服务安装导致 ctx.search 尚不存在，修正脚本后通过。
- 当前仅内存注册表，没有搜索调用、定时器或 Abort 监听器；不提前声称执行取消、HTTP 安全和深层不变性已实现。
- 验证：`pnpm typecheck` 通过；`pnpm test` 15 文件/110 测试通过；临时 tsx 离线冒烟覆盖零/单/多 Adapter、重复/非法 ID、默认缺失不降级、配置快照、调用插件卸载、手动重复撤销和重注册保护、安全模型消息。
- 未新增持久测试文件，正式行为测试属于 6.10；没有联网或读取真实密钥。

## 下一步

- 人工审查后进入 6.9.4：搜索执行、运行时输入输出校验、有界结果、取消与超时。
- Mock、Exa、搜索工具及输出格式分别在 6.9.5–6.9.7，应用组合在 6.14。
