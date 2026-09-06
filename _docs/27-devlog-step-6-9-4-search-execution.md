# Step 6.9.4 搜索执行与边界防护

## 做了什么

- 修改 `search/types.ts`、`search/service.ts`，新增 `search/validation.ts`、`search/execution.ts`（均位于 `src/tools/builtins/`）。
- `ctx.search.search()` 归一化请求、确定性路由、执行 Adapter，输出复制冻结的有界来源。
- 请求限制：查询非空且原始长度不超过 2000，结果数默认 8、范围 1–20；仅复制协议字段。可信 timeoutMs 默认 30000，允许 1–300000。
- 来源限制：标题 300、摘要 2000、URL 8192 字符；保留前 N 项并校验，丢弃项不遍历；裁剪设 truncated。空数组正常；保留项非法则整体拒绝，不静默跳过。

## 关键决策

- 对齐 Harness `packages/web/web/src/index.ts` 的执行时路由、Provider 委托和结果数量限制；沿用本项目独立 Search 协议，不引入 Fetch、生成式答案、动态可用性探测或环境配置回退。
- 比 Harness Web seam 增加集中输入输出校验、冻结、单次期限和取消竞争；不是直接复制其仅透传 signal 的执行方式。
- 每次调用独立 controller、timer、listeners，并挂载调用 Cordis fiber 的清理 effect；插件卸载结束其搜索等待，手动注销 Adapter 只影响后续路由，不主动取消已选中的调用。
- 预取消优先于校验/路由；执行接纳前检查调用取消及单调时钟期限，避免阻塞事件循环后错误接受超时结果；取消或超时先确定终态，再通知 Adapter。
- 同步 throw、Promise 拒绝均被观察，迟到结果不接纳，迟到拒绝有处理器。正常/失败/取消均清除定时器和监听器；不强停不合作 Adapter，不支持抢占同步阻塞代码。
- 来源 URL 只校验 HTTP(S) 语法与无嵌入凭证，不联网、不做 DNS/SSRF 判定；实际抓取的安全边界在阶段 7 Fetch。
- publishedAt 若存在需为可解析的 ISO 风格日期时间且不超过 64 字符，不凭空补日期。未知字段不进入结果；readonly 本步落实为源条目、数组及结果对象的冻结。
- SearchError 保留原分类；未知异常转 request-failed，内部原因仅在 cause，模型消息仍为固定文本。输出字段预算不是 HTTP 字节预算，后者在 Exa Adapter 实现。

## 坑与发现

- 不能只依靠 Adapter 协作取消，否则不合作 Promise 会一直阻塞调用方；也不能只靠 timer 回调判断期限，因为同步执行可能阻塞事件循环。
- `pnpm typecheck` 通过；`pnpm test` 15 文件/110 测试通过。
- 临时离线冒烟覆盖输入、默认值、URL、空结果、截断、复制冻结、预取消、调用中取消、超时、迟到拒绝、调用插件卸载、同步异常和非法响应，通过后删除脚本；正式持久测试在 6.10。
- 本次由后端串行更新索引并使用 27 号记录；未修改前端或应用组合，未联网。

## 下一步

- 审查后进入 6.9.5 Mock Adapter，再实现 Exa 和工具输出；不提前实现阶段 7 Fetch。
