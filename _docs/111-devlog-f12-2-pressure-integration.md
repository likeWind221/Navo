# F12.2 上下文压力检测与执行接入

> 日期：2026-10-17  
> 状态：🔄 开发中，等待完整验证  
> 范围：把 F12.1 的预算与测量接入真实 Agent 请求路径，形成独立、可测试的压力触发点；本 Step 不生成摘要、不修改 Session surface。

## 1. 目标与流程

在每次模型请求发送前，用当前请求 envelope 与 Session 已落盘事件测量上下文压力。预算禁用时不触发；低于阈值时保持现有行为；达到阈值时发布内部 `context/pressure` 事件，供 F12.3 的压缩阶段消费。当前 Step 即使检测到压力，也继续发送原请求，因为真正的摘要压缩属于 F12.3。

```text
Build request envelope
        |
        v
Inspect budget + Session history
        |
        +-- disabled --------------------> send request unchanged
        |
        +-- below threshold ------------> send request unchanged
        |
        +-- at / above threshold
                    |
                    v
           emit context/pressure
                    |
                    v
             send request
```

## 2. 改动

- 默认比例阈值已从 80% 调整为 90%，与 Codex 当前公开实现的默认自动压缩比例一致；仍由 `W - O - H` 与显式 `L` 进一步限制。此改动不改变固定安全余量、输出预留或保留尾部比例。

- `src/context/pressure.ts`：新增纯压力判定入口，区分预算禁用、阈值内和超阈值三种结果；超阈值时构造包含 Session、模型路由、用量、阈值、保留预算与估算依据的内部事件。
- `src/agent/request.ts`：在记录并发送请求前，使用同一请求 envelope 与 Session 事件完成测量；超阈值时发布 `context/pressure`。
- `tests/context/pressure.spec.ts`：覆盖阈值内、超阈值、容量缺失与触发事件发布。
- `tests/agent/runtime.spec.ts`：覆盖真实 Agent 请求路径会发布触发事件，且当前 Step 不会因压力检查阻断原请求。
- 不修改 Session 事件 schema、历史投影或持久化格式；这些属于 F12.3。

## 3. Harness 对照与取舍

只读检查 DeepSeek Harness 对应 commit `d743267388641bc76f17c45ce8b4c231aed1d32c` 的 `compaction-basic/src/index.ts`、`region.ts` 与 `config.ts`。Harness 在 `agent/pre-step` 检查压力，并由压缩后端负责选择历史区间与事务写入。Navo 当前采用更窄的分步实现：本 Step 只在 `requestModel` 入口检测并发出内部事件；F12.3 再实现摘要、检查点与失败处理，不在本 Step 提前引入压缩事务。

## 4. 验收状态

- [ ] 本机 `pnpm typecheck`
- [ ] 本机完整 `pnpm test`
- [ ] 当前 PR head 的 GitHub CI
- [ ] 确认压力检查前后请求内容不变，超阈值只增加内部触发事件
- [ ] 记录实际测试结果与未覆盖边界

目前尚未执行本机完整测试；在完整验证和当前 PR head CI 均通过前，不标记完成、不合并。
