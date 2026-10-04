# 天文观测计划编排台（gbobsplan）

面向业余天文台与高校天文社团的值班排期人员：把「观测目标—可见窗口—月相—望远镜与终端—备用观测夜」串成一份可执行的观测夜编排表，解决目标亮度与月相冲突、设备被重复占用、阴天临时改期难以追溯的问题。纯前端单页应用，数据全部保存在浏览器本地，不依赖任何后端服务或外部接口。

## Docker 一键启动

```bash
cp .env.example .env
docker compose up -d --build
```

启动后访问：<http://localhost:21813>

停止并清理：

```bash
docker compose down
```

## 技术栈

| 层次 | 选型 |
| --- | --- |
| 框架 | React 18 + TypeScript |
| 构建 | Vite 6（`npm run build` 含 `tsc --noEmit` 类型检查） |
| UI | MUI（Material UI 5）+ Emotion |
| 路由 | React Router 6（5 条业务路由 + 404） |
| 状态 | Zustand（targetStore / sessionStore / equipmentStore / nightStore） |
| 存储 | IndexedDB（Dexie）：目标库 `gbobsplan-target-db` + 编排库 `gbobsplan-schedule-db` 物理隔离，各写各的 |
| 托管 | nginx:alpine（多阶段构建，SPA try_files + gzip） |

## 本地开发

```bash
cd frontend
npm install
npm run dev      # http://localhost:21813
npm run build    # 类型检查 + 生产构建
```

## 目录结构

```
.
├── docker-compose.yml         # 顶层 name / COMPOSE_PROJECT_NAME 容器名 / 端口映射
├── .env.example               # COMPOSE_PROJECT_NAME、FRONTEND_PORT
├── frontend/
│   ├── Dockerfile             # node:20-alpine 构建 → nginx:alpine 托管
│   ├── nginx.conf             # try_files SPA 回退 + gzip
│   ├── public/favicon.svg
│   └── src/
│       ├── types/             # target / session / equipment / night（+ index.ts 统一出口）
│       ├── db/                # targetDb（目标库）/ scheduleDb（编排库）/ bootstrap（回填+seed）/ seed
│       ├── stores/            # targetStore / sessionStore / equipmentStore / nightStore
│       ├── components/common/ # Timeline / StatusChip / ConflictBadge / FieldRow
│       ├── hooks/             # usePersistentStore（开库+回填+同步）/ useConflictCheck
│       ├── pages/             # OverviewPage / TargetsPage / SessionsPage / EquipmentPage / ExportPage
│       ├── router/index.tsx   # 路由表
│       └── utils/             # astro.ts（高度角/可见窗口/月相）/ schedule.ts（容量排队）/ export.ts / id.ts
```

## 功能与路由

| 路由 | 页面 | 说明 |
| --- | --- | --- |
| `/` | 本夜编排总览 | 30 分钟刻度时间轴 + 月相与月出月落条带；冲突与低于高度阈值的目标自动标灰 |
| `/targets` | 观测目标库 | 按类型与优先级筛选、按视星等排序、维护地平高度阈值与曝光参数，并给出本夜可见窗口 |
| `/sessions` | 排程段与冲突 | 冲突检测结果、按时段/望远镜校验，勾选多条批量改期到备用观测夜并填写改期原因 |
| `/equipment` | 设备分配视图 | 行 = 望远镜、列 = 30 分钟时段；冲突格标红，点击可一键跳转到对应排程段 |
| `/export` | 导出观测清单 | 目标、时刻、滤镜、帧数导出为文本与 CSV，支持打印视图 |

## 数据存储说明

- 全部数据存于浏览器 IndexedDB（Dexie），按职责拆成两个物理隔离的库，各写各的，谁也改不到对方那份：
  - **目标协调员侧** `gbobsplan-target-db`：仅 `targets` 表（观测目标、曝光参数、高度阈值），由 `targetStore` 写入。
  - **值班排程员侧** `gbobsplan-schedule-db`：`sessions`（排程段）、`nights`（观测夜）、`telescopes` / `instruments`（望远镜与终端占用）、`meta`，由 `sessionStore` / `nightStore` / `equipmentStore` 写入。
- **阈值改动 → 排程段失效**：协调员在目标库调整高度阈值后，引用该目标的「待执行」排程段会被置为新状态「待重排」，由排程员在「仅看待重排」里确认重排；「已完成 / 进行中」的段留住不动。协调员不直接写编排库，只调排程员侧的 action。
- **容量排队**：同一台望远镜在同一夜已确认的段加起来超出该夜容量（日落到日出的暗时段分钟数）时，新增段排到下一夜并置为「待重排」，不挤掉已确认的段。
- **任一侧写入失败只回滚本侧**：两个库各用各的 Dexie 事务，单库内批量写包在一个事务里；目标侧与编排侧的写入互不牵连，一侧失败不影响另一侧已提交的内容。
- **升级前老数据回填**：首次打开新库时，`bootstrap` 会打开旧混库 `gbobsplan-db`，把没有归属的老数据按现有内容回填到两个新库（目标归目标库，排程/观测夜/设备归编排库），`meta` 写 `legacyBackfilled` 标记只回填一次，然后再启用。
- 首次打开且两库为空时写入示例数据（12 个观测目标、5 个观测夜、4 台望远镜、4 台终端、14 段排程，含 1 处设备冲突与 1 条改期记录）。
- 容器无状态：不使用数据库服务、不挂载命名卷，`docker compose down` 后数据仍留在浏览器中。
