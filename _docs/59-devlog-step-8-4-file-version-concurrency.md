# 8.4 文件版本与并发安全开发记录

## 目标

8.4 不增加新的模型工具，目标是收口 `read/edit/write` 在共享工作区中的 lost-update、stale overwrite 与并发创建问题，同时保持 `shell` 为独立执行能力。

## 最终架构

```text
Read
  ↓
Observation(path, V1)
  ↓
Edit / Write(existing)
  ↓
Target Lock
  ↓
currentVersion == V1 ?
  ├─ no  → stale-version
  └─ yes → staging → final version check → atomic publish

Write(absent)
  ↓
staging
  ↓
create-if-absent publish
```

Shell 不加入上述协调链。Shell、IDE 或外部进程若修改文件，下一次结构化修改由版本比较发现 stale；Shell 的文件访问范围与审批策略留给后续 Sandbox。

## FileVersion

新增 `src/tools/builtins/file/version.ts`。本地版本 token 使用：

```text
dev:ino:size:mtimeNs
```

这是一个 opaque freshness token，而不是自增业务版本，也不是内容 hash。

- `dev + ino`：区分本地文件对象身份，能识别删除后同名重建等替换。
- `size + mtimeNs`：低成本判断文件内容是否在观察后发生常规变化。
- 不使用 SHA-256：本阶段需要的是高频 freshness check，不是内容寻址或密码学完整性；stat token 无需重新扫描完整文件。SHA 同样不能消除“检查之后、提交之前”的外部 TOCTOU，因此不能替代 mutation critical section。
- 不纳入 `ctimeNs`：SkillWorld 当前把版本用于文本修改 freshness；纯权限/元数据变化不应无条件使内容 observation 失效，同时 staging 在 rename 后继续保持 `dev/ino/size/mtimeNs` 版本语义稳定。

该设计参考 DSH 的 high-resolution stat version 思路，但不是逐字段复制 DSH 当前 `dev:ino:size:mtimeNs:ctimeNs` 实现。

## Read：只观察稳定版本

`readTextFileWithVersion()` 在读取前从已打开句柄取得版本，读取结束后再次检查：

1. 打开句柄的版本没有变化；
2. canonical target 仍存在且仍指向同一版本。

任一不满足则返回 `stale-version`，本次 Read 不建立 observation。

`FileObservationStore` 从布尔 observed 升级为 `path -> FileVersion`。分页 coverage 也绑定版本；如果第二页来自另一个版本，会重置之前的 coverage，因此不同版本的分页结果不能组合成“完整读过”。

## Edit / Write：基于 observed version 修改

已有目标的 Write 与模型侧 Edit 必须取得当前 Session 完整 observation 的版本。

进入同一 canonical target 的 `FileMutationCoordinator.runTarget()` 后：

1. 读取 observed version；
2. probe 当前版本；
3. 不一致则忘记旧 observation 并返回 `stale-version`；
4. staging 完整结果；
5. publication 前再次 `assertFileVersion()`；
6. atomic replace；
7. 用新版本刷新当前 Session observation。

目标级串行化解决当前 SkillWorld 进程内两个 Session 同时基于 V1 修改同一个文件的 lost update：只有第一位提交者成功，后进入的调用看到 V2 后失败。

Edit 仍保留 `oldText` 唯一字面匹配。版本 guard 决定“是否仍是读过的版本”，literal match 决定“在该版本中改哪一处”，两者职责分离。

## create-if-absent

原先的新文件路径存在：

```text
check absent → staging → rename(target)
```

这会在 absent check 与 rename 之间留下 create race。8.4 为原子写增加 `create-if-absent` commit mode：

```text
sibling temp (wx)
  ↓
write + chmod + fsync + close
  ↓
link(temp, target)
  ├─ success → commit
  └─ EEXIST  → reject
```

hard-link 发布要求 sibling temp 与 target 位于同一文件系统；成功后 target 与 staging 指向同一 inode，再清理 staging 名称。因此并发创建不会静默覆盖已有创建者。Fetch spill 同样使用该路径。

## Shell 的最终边界

8.4 早期候选曾考虑让 Shell 获取全局 barrier，并在 Shell 完成后清空所有 observation。最终撤销该方案。

原因是 Shell 与结构化 File Tools 解决的是不同安全问题：

```text
File Tools → read-before-write / stale-version / atomic mutation
Shell      → arbitrary command execution / future sandbox policy
```

因此最终代码中：

- Shell 不依赖 `FileMutationCoordinator`；
- Shell 不清空 `FileObservationStore`；
- Shell 内 `cat/head/python open()` 不产生受信任 observation；
- Shell/IDE/外部 actor 若实际改了文件，后续 Edit/Write 由 version guard 检测 stale；
- Sandbox、approval、workspace-write/read-only 等能力延期到后续阶段。

## 测试覆盖

新增/调整 focused tests 覆盖：

- 外部修改 V1→V2 后 Write 返回 stale-version，V2 不被覆盖；
- 两个 Session 同时从 V1 写入，同进程内只有一个成功；
- 不同版本的分页 Read coverage 不可拼接；
- 两个并发 create-if-absent 只有一个成功；
- Edit 必须先完整观察，并拒绝 stale observed version；
- 非修改型 Shell 不会无条件清空 File observation。

受当前执行环境限制，本阶段没有在这里执行最终 Node 24 + pnpm 全量回归；完整 `pnpm install --frozen-lockfile`、typecheck、Vitest 与 build 由 8.5 在本地环境完成。

## 已知边界

当前保证：

```text
同 SkillWorld 进程内结构化同目标写并发    有保护
已有文件 stale overwrite                 有保护
并发新建同一路径                         有保护
读取期间目标变化                         有保护
外部普通修改后的后续结构化写             可检测
```

当前不保证：

```text
跨进程 replace-if-version 原子 CAS
分布式锁 / 跨主机一致性
Shell 文件权限沙箱
远程文件系统版本协议
```

尤其 `assertFileVersion()` 与最终 `rename()` 之间仍存在极小的外部进程 TOCTOU 窗口；这不是 SHA-256 可以单独解决的问题。若未来需要更强跨进程语义，应下沉到提供方/内核级 guarded mutation，而不是继续堆叠模型工具层检查。
