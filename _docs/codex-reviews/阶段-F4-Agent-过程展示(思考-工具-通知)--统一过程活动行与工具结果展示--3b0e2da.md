# Git Commit 3b0e2da（feat(frontend): 完成 F4 过程展示并归档验收记录）— 阶段 F4：Agent 过程展示（思考 / 工具 / 通知）

## 🟠 Medium（警告）

### [Bug] 工具图标查找会误取原型属性并导致渲染崩溃
位置：frontend/src/workspace/chat/process/tool.ts:23
**问题：** 当工具名为 `constructor` 或 `__proto__` 时，`icons[name]` 会返回普通对象继承的函数或原型对象，因而不会触发 `?? "tool"`。该值传入 Icon 后，无法取得有效的 Shape，导致 React 渲染异常。公共事件校验允许这些工具名，工具注册也没有禁止；模型产生此类未知工具调用时同样可能触发。
**影响：** 本应显示为通用工具行或未知工具失败的事件会使消息组件渲染崩溃，阻断当前会话展示。
**建议：** 仅在 `Object.hasOwn(icons, name)` 为真时取映射值，否则使用 `"tool"`；补充 `constructor` 和 `__proto__` 的映射及渲染回归测试。
