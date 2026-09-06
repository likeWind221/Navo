# Step 6.5 Node Store 行为测试开发记录

## 做了什么

- 新增 Node 创建、输入隔离、深冻结、事件顺序和未知 Node 读取测试。
- 验证 Node–Session 一对一绑定、Session 反查和分类错误。
- 直接构造非法事件流，覆盖跨 Node 事件、revision 跳号、先绑定、重复创建和重复绑定。
- 验证事件提交后发布、同步/异步观察者失败隔离及 Cordis Service 卸载。

## 关键决策

- Store 行为和纯 projector 行为分组测试，避免只能通过私有 Store 状态间接覆盖严格重放。
- 非法历史使用表驱动样例，每个样例都断言稳定的 `invalid-event-stream` 分类。
- 输入对象在提交后主动修改，用实际行为证明 structuredClone 边界，而不只检查 `Object.isFrozen()`。

## 坑与发现

- `getBySession()` 当前扫描并投影全部 Node，适合阶段 6 的小规模内存 Store；数据规模增长后再用事务同步的反向索引优化。
- Cordis 的并行事件分发会继续调用健康观察者，并把同步抛错和异步拒绝统一收敛到发布 Promise。
- Harness 的 fold 测试还覆盖持久化版本解码和继承日志筛选；当前没有这些能力，因此没有提前复制对应样例。

## 下一步

Step 6.6 根据教材与练习 UI 的真实读取需求定义内容快照、隐藏参考答案、revision 和替换事件。
