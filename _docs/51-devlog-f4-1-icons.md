# F4.1 过程图标库开发记录

## 做了什么

- 把 `frontend/src/ui/Icon.tsx` 从三枚内联图标的条件渲染，改成自绘图标库的入口：对外只暴露 `Icon` 组件与 `IconName` 联合类型。
- 新增 `frontend/src/ui/icon/` 单图标目录：原有 `Arrow`、`Book`、`Guide` 迁入且图标名不变，新增 `Brain`、`Tool`、`Loader`、`Check`、`Close`、`Chevron`。
- 预览页 `frontend/src/preview/Sample.tsx` 展示全部九枚图标，并演示 `loader` 的旋转状态。
- 新增桌面 QA `frontend/scripts/qa/icons.cjs` 与 `frontend/package.json` 的 `qa:icons` 命令：在 Electron 中加载视觉样板页，断言九枚图标按顺序出现、都渲染出非空图形、尺寸统一为 20×20、只有“进行中”处于旋转态，并检查窄窗口无横向溢出。

## 关键决策

- **入口持有视觉参数，单图标文件只画形状。** `<svg>` 外框、`viewBox`、`stroke-width`、圆头圆角与 `aria-hidden` 留在 `Icon.tsx`，图标文件只返回形状元素，避免九份重复的描边配置漂移。
- **用类型做穷尽检查。** `shapes` 声明为 `Record<IconName, () => React.JSX.Element>`，新增图标名却忘了实现时 typecheck 直接失败，不需要额外测试。
- **图标不承载语义。** 状态到图标的映射留给呈现层，图标文件既不知道“思考完成”也不知道“工具失败”，只画形状。
- **不引入图标依赖，颜色一律 `currentColor`。** 延续 F1.2.1 确定的视觉基线，图标随所在文字颜色变化。
- **不扩展尺寸 API。** 仍是固定 20×20；本步没有需要其他尺寸的使用方，需要时由所在模块的 CSS 控制，不为假设中的用法提前加 `size`/`className`。

## 坑与发现

- **手写 path 必须实机确认。** 第一版工具图标横放，20px 下读起来像钥匙；改为 `transform="rotate(-45 12 12)"` 后成为斜置扳手。思考图标两个椭圆重叠过多时像一颗豆子，把 `rx` 从 3.2 收到 2.9、收窄重叠后两瓣关系才清楚。两处都是靠渲染截图发现，单看坐标判断不出来。
- **QA 脚本的固定等待不可靠。** 第一次运行成功、第二次直接报 `Script failed to execute`：`vite` 首次编译比 300ms 固定等待更慢，样板节点还没挂上。改成轮询等待节点出现并在开头清理上次的 `error.txt`。
- **该样板页只在 DEV 下存在**（`import.meta.env.DEV`），所以脚本默认加载 `dev:web` 的 5173 端口，不同于 `static.cjs` 使用的 4173 预览端口；运行 `qa:icons` 前需要先起 `pnpm --dir frontend dev:web`。

## 下一步

F4.2 回合过程折叠：按回合切分过程与最终回答，生成中展开、结束后折叠，手动展开过的回合不再自动折叠。本步交付的图标将在 F4.2–F4.4 接入过程行、工具行与通知行。
