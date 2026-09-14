# F4.3 过程状态栏、顺序过程流与用时开发记录

## 做了什么

- 把 F4.2 的过程折叠头拆成三层信息结构：顶部固定状态行、中间按真实事件顺序保留的过程段、最终回答前的折叠边界。顶部不再承担折叠操作。
- `ProcessRow` 在回合进行中每秒刷新一次显示时间，固定显示“处理中 Ns”；回合进入终态后使用消息已有 `endedAt` 计算“已处理 Ns”，不再继续读取当前时钟，因此完成、停止、失败与截断后的总用时会冻结。
- reasoning 流式阶段显示“思考中”；该段完成后，从 reasoning 的首个完整句子提取摘要，最长 36 个字符，缺少内容时回退“思考过程”。摘要只描述该段过程，不再改写顶部状态标题。
- 工具过程标题统一成“执行 {工具名}”；Shell 大小写归一为“执行 Shell”。参数、结果、失败信息继续沿用 F3/F4.2 的工具详情，不在本 Step 提前做 F4.4 的统一行样式。
- 展开状态下在状态行与过程之间增加上分隔线；最终回答前保留可操作的下分隔线。回合生成中下分隔线禁用，过程强制展开；有最终回答且回合结束后过程自动折叠，下分隔线恢复为展开/折叠入口。
- v2 直接回答即使没有 reasoning 或工具过程，也显示“处理中 / 已处理”状态与用时；没有过程时不渲染无意义的折叠边界。
- Electron `qa:process` 场景更新为“思考 → Shell → 思考 → Shell → 最终回答”，增加实时计时变化、终态计时冻结、生成中不可折叠、结束后自动折叠、重新展开、最终回答持续可见和横向溢出断言。

## 模块职责

```text
AssistantMessage
    |
    v
splitTurnContent
    |
    +--> process blocks -----------------------------+
    |                                                |
    |                                                v
    |                                         ProcessRow
    |                                      +-- 状态与总用时
    |                                      +-- 上分隔线
    |                                      +-- 顺序过程块
    |                                      +-- 折叠边界
    |
    +--> final answer ------------------------------> Markdown
```

- `chat/process.ts`：只负责过程/最终回答切分、折叠判据、用时文案、reasoning 摘要和工具过程标题等纯展示规则。
- `chat/process/Row.tsx`：持有展开状态和显示层计时器；终态时间仍以会话消息的 `endedAt` 为事实来源。
- `chat/process/Block.tsx`：把 reasoning / tool 的单块内容映射成过程条目；工具参数和结果详情保持既有结构。
- `chat/List.tsx`：仍负责一次助手消息的“过程 + 最终回答”组合，不把最终回答移入折叠体。
- `workspace/style.module.css`：只定义状态行、上下边界及现有过程块布局，不改变 F3.8/F3.9 的滚动区、输入框覆盖和消息列几何。

## 关键决策

### 顶部状态不再追踪“当前正在做什么”

原 F4.3 方案计划让顶部标题在 reasoning、工具和中间说明之间跳变。用户确认改为稳定的信息层级：顶部只回答“这一回合是否还在处理、已经多久”，具体做了什么由下面的过程条目表达。这样多次 reasoning / tool 不会覆盖前一阶段的可读历史。

### 显示计时器不是新的业务时间事实

`startedAt / endedAt` 继续由会话 reducer 在回合提交和终态事件处写入。React 定时器只在 `endedAt === null` 时触发重渲染；一旦终态到达，显示直接使用 `endedAt - startedAt`。因此 UI 刷新频率不会改变最终耗时，也不需要扩展 `agent.turn.v2`。

### 折叠边界位于结果之前

生成中：

```text
处理中 4s
--------------------
思考摘要
执行 Shell
--------------------  disabled
最终回答（如已开始生成）
```

结束后默认：

```text
已处理 9s
--------------------  可点击展开
最终回答
```

重新展开后恢复上下两条边界和完整过程。只有过程、没有最终回答的回合继续保持展开，沿用 F4.2 的避免“孤立折叠标题”规则。

## 验证与当前边界

已完成：

- 仓库静态引用核对：旧 `processHeader` 选择器与组件入口已移除，QA 改为 `processStatus / processBoundary`。
- 使用当前运行环境自带 TypeScript 编译器对本次核心 `process.ts`、`Row.tsx`、`Block.tsx` 做独立语法转译检查，三者均无语法诊断。
- 更新单元测试覆盖实时/终态用时、reasoning 摘要、Shell 标签、生成中禁折叠、终态折叠和无最终回答边界。
- 更新 Electron QA 场景与断言，但尚未在当前环境实际启动 Electron 执行。

尚未完成：当前执行环境无法解析 GitHub / npm 网络，无法取得仓库依赖，因此没有实际运行 `pnpm --dir frontend typecheck`、`pnpm --dir frontend test`、`pnpm --dir frontend build` 和 `pnpm --dir frontend qa:process`。在这些命令于完整本地仓库通过前，F4.3 在 `frontend-plan.md` 保持“进行中（代码完成、待自动验收）”，不提前标记为最终完成。

## 下一步

在有完整前端依赖的本地仓库执行：

```text
pnpm --dir frontend typecheck
pnpm --dir frontend test
pnpm --dir frontend build
pnpm --dir frontend qa:process
```

四项通过并完成桌面视觉确认后，把 F4.3 标记为完成，再进入 F4.4 工具行与通知行统一。
