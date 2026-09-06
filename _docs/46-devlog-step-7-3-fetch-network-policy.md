# Step 7.3 URL 与公共网络策略开发记录

## 做了什么

- 新增 `src/tools/builtins/fetch/policy.ts`，限制 URL 长度、HTTP(S) 协议和内嵌凭据，并提供规范化同源判断。
- 新增 `src/tools/builtins/fetch/network.ts`，校验完整 DNS 地址集、IPv4/IPv6/映射地址及 NAT64 目标，并通过 Undici 自定义 lookup 固定实际连接地址。
- DNS 等待与固定连接均贯穿 AbortSignal；请求返回独立 close()，由后续 HTTP 实现在读取或取消响应体后释放私有 Dispatcher。
- 精确加入 `ipaddr.js@2.5.0` 与 `undici@8.10.0`，保留并行 Kernel Host 已加入的根包脚本与其他依赖变更。

## 关键决策

- 只要同一主机名的 DNS 答案中包含一个非公网或非法地址，整个目标即被拒绝，不从混合结果中挑选可用地址。
- DNS 只解析一次；实际 HTTP Host 与 TLS SNI 保留原主机名，而连接 lookup 只能返回已经验证的固定地址，防止 DNS rebinding。
- RFC 7050 发现当前网络的 DNS64 前缀，并按 RFC 6052 提取 NAT64 内嵌 IPv4；翻译后指向内网的地址同样拒绝。
- network.ts 只提供安全网络原语，不暴露 Cordis Service，也不读取 Cookie、代理凭据或环境认证。

## 坑与发现

- WHATWG URL 的 IPv6 hostname 保留方括号，交给 IP 解析器前必须移除，固定连接时再保留 URL 原始主机语义。
- 调用方取消与 DNS 原始失败可能同时发生；错误收敛必须优先返回 aborted，避免原始 resolver 异常越过安全错误协议。
- 地址固定只能防止连接阶段再次解析；重定向的每一跳仍必须在 7.4 重新执行 URL、DNS 和同源检查。

## 下一步

进入 Step 7.4，实现 FetchCore 使用的匿名 HTTP 读取函数、同源重定向循环、响应类型与字符集分类、有界流读取和资源释放。
