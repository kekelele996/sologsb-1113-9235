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
| 存储 | IndexedDB（Dexie，库名 `gbobsplan-db`，`schemaVersion` + v2 迁移） |
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
│       ├── stores/            # targetStore / sessionStore / equipmentStore / nightStore
│       ├── components/common/ # Timeline / StatusChip / ConflictBadge / FieldRow
│       ├── hooks/             # usePersistentStore（Dexie 读写 + Zustand 同步）/ useConflictCheck
│       ├── pages/             # OverviewPage / TargetsPage / SessionsPage / EquipmentPage / ExportPage
│       ├── router/index.tsx   # 路由表
│       └── utils/             # astro.ts（高度角/可见窗口/月相）/ export.ts / id.ts
```

## 功能与路由

| 路由 | 页面 | 说明 |
| --- | --- | --- |
| `/` | 本夜编排总览 | 30 分钟刻度时间轴 + 月相与月出月落条带；冲突与低于高度阈值的目标自动标灰，待重排段单独提示 |
| `/targets` | 观测目标库 | 归属目标协调员：按类型与优先级筛选、按视星等排序、维护地平高度阈值与曝光参数（变更后未开拍的引用排程段自动转入待重排），并给出本夜可见窗口 |
| `/sessions` | 排程段与冲突 | 归属值班排程员：冲突检测结果、按时段/望远镜与当夜容量校验，待重排池重排失效排程段，勾选多条批量改期到备用观测夜并填写改期原因 |
| `/equipment` | 设备分配视图 | 行 = 望远镜、列 = 30 分钟时段；冲突格标红，点击可一键跳转到对应排程段；每台望远镜显示当夜容量占用 |
| `/export` | 导出观测清单 | 目标、时刻、滤镜、帧数导出为文本与 CSV，支持打印视图 |

## 分侧归属（目标协调员 / 值班排程员）

目标库与编排表分侧管理，各自管各的，谁也改不到对方那份：

- **目标协调员**：观测目标、曝光参数、地平高度阈值（`targets` 表）；**值班排程员**：观测夜、排程段、望远镜占用（`nights` / `sessions` / `telescopes` / `instruments` 表）。每条记录带 `owner` 归属字段。
- 所有写入经过归属校验（`persistSideRow` / `runSideTransaction`）：协调员事务只含 `targets`，排程员事务只含排程侧四表，跨侧写入直接抛 `CrossSideWriteError`；任一侧写入失败只回滚本侧，不会波及另一侧。
- **失效级联**：目标的高度阈值或曝光参数（单帧曝光 / 建议累计 / 推荐滤镜）变更后，引用该目标且未开拍（待执行 / 进行中）的排程段自动失效，挑入「待重排」池并记录失效原因；已拍完（已完成）与已取消的段照旧保留。级联是排程侧的独立事务，其失败只回滚排程侧，目标改动保留。
- **容量排队**：同一观测夜同一台望远镜的已确认排程段（待执行 / 进行中 / 已完成）合计时长超出当夜容量（日落→日出落在 18:00–次日 06:00 时间轴内的分钟数）时，新写入或改期的段自动转入待重排、排队等下一夜，不挤掉已确认的段。
- 待重排的段退出望远镜占用（不参与冲突检测与设备占用网格），排程员在「排程段与冲突」页的待重排池中重新安排，保存时重新校验容量。

## 数据存储说明

- 全部数据存于浏览器 IndexedDB（Dexie，库名 `gbobsplan-db`），表：`targets`、`sessions`、`telescopes`、`instruments`、`nights`、`meta`。
- `db.version(1).stores({...})` 声明索引；`db.version(2).upgrade(...)` 为排程段增加 `backupNightId` 索引，并给旧数据补齐 `schemaVersion` 与因云取消排程段的替补夜。
- `db.version(3).upgrade(...)` 拆分归属：升级前没有 `owner` 的老数据按现有内容回填（`targets` → 目标协调员，其余四表 → 值班排程员），全部回填完成后才写入 `meta: domain-split=enabled` 启用分侧归属；排程段 `schemaVersion` 升至 3。
- 排程段状态：待执行 / 进行中 / 已完成 / 因云取消 / 待重排（目标参数变更失效或容量溢出排队）。
- 首次打开且表为空时写入示例数据（12 个观测目标、5 个观测夜、4 台望远镜、4 台终端、15 段排程，含 1 处设备冲突、1 条改期记录与 1 条待重排记录）。
- 容器无状态：不使用数据库服务、不挂载命名卷，`docker compose down` 后数据仍留在浏览器中。
