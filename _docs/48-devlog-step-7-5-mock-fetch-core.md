# Step 7.5 Mock FetchCore 开发记录

## 做了什么

- 新增继承真实 FetchCore 的脚本化 Mock，支持结果、异常、挂起、请求记录和剩余脚本计数。

## 关键决策

- Mock 只替换匿名底层读取函数，仍经过真实 Core 的请求校验、超时、取消、结果冻结和错误归一化。

## 坑与发现

- 挂起脚本使用一次性 AbortSignal 监听器，不创建 timer 或系统句柄。

## 下一步

实现 HTML 转换、输出预算和 FetchTool。
