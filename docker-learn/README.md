# Docker 学习笔记与 Session 交接

**目的：** 学会用 Docker / Compose 跑 PostgreSQL，为后续「JSON → 数据库 + 腾讯云轻量部署」打基础。  
**原则：** 先学 Docker，**不要**一上来就 `/define` 改业务代码。  
**练习目录：** `server/docker-learn/`（本文件所在目录）

相关产品背景（room-booking monorepo）：

- 小程序 + Express API + Admin；当前数据在 `server/data/store.json`
- 正式部署前要换成 PostgreSQL；本地希望 **Docker Compose：先 `db`，以后再加 `api`**
- Admin 仍本机 `pnpm dev:admin`，不进 Compose（已选定的起步形态）

---

## 新 Session 开场可粘贴（给 AI）

```text
请接着教我 Docker，不要写 define/plan，不要先改 room-booking 业务代码。

背景：
- 已安装 Docker Desktop，会用 docker compose
- 练习目录：room-booking/server/docker-learn/
- 已成功：compose up postgres:16，psql 进库，SELECT 1，建过练习表 rooms 并 INSERT/SELECT
- 目标形态：Compose 仅 api + db；Admin 本机跑；最终 JSON store → PostgreSQL，再上腾讯云轻量

请从「volume 停掉再起来数据还在」和「DATABASE_URL 本机连接概念」继续教，一步一步，少讲概念多给命令。
完整笔记见：server/docker-learn/README.md
```

---

## 已完成进度

- [x] 安装 Docker Desktop  
- [x] `docker version` / `docker compose version`  
- [x] `docker compose up -d` 拉取 `postgres:16`，容器名 `room-pg-learn`  
- [x] `docker compose exec db psql -U room -d room_booking`  
- [x] `SELECT 1;`  
- [x] 练习：`CREATE TABLE rooms` → `INSERT` → `SELECT *` → `\dt` → `\q`  

## 建议接下来学（按顺序）

1. `stop` / `up -d` / `down` vs `down -v`（数据还在吗）  
2. 本机连接串概念：`DATABASE_URL=postgres://room:roompass@127.0.0.1:5432/room_booking`  
3. （可选）本机用 `psql` 或 GUI 连 `localhost:5432`，不 `exec` 进容器  
4. Compose 里加第二个服务的直觉（以后的 `api`）  
5. 再谈：给 `server/` 写 Dockerfile + 正式 compose，JSON 迁移进 PG  

---

## 核心概念（极简）

| 概念 | 含义 |
|------|------|
| Image | 模板/安装包（如 `postgres:16`） |
| Container | 跑起来的实例 |
| Compose | 一个 YAML 起多个服务 |
| Volume | 持久磁盘；删容器默认不删 named volume |
| 端口映射 | `"5432:5432"` = 本机端口:容器端口 |

---

## 当前 `docker-compose.yml`

```yaml
services:
  db:
    image: postgres:16
    container_name: room-pg-learn
    environment:
      POSTGRES_USER: room
      POSTGRES_PASSWORD: roompass
      POSTGRES_DB: room_booking
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

连接信息：

- 用户：`room`  
- 密码：`roompass`  
- 库名：`room_booking`  
- 本机：`127.0.0.1:5432`  
- URL：`postgres://room:roompass@127.0.0.1:5432/room_booking`

若本机已有 Postgres 占用 5432，改为 `"5433:5432"`，URL 端口改成 `5433`。

---

## 常用命令（在 `server/docker-learn/` 下执行）

```bash
cd server/docker-learn

docker compose up -d          # 启动（后台）
docker compose ps             # 状态
docker compose logs -f db     # 日志，Ctrl+C 退出跟随
docker compose exec db psql -U room -d room_booking   # 进 psql

docker compose stop           # 停止容器，保留
docker compose start          # 再启动
docker compose down           # 删容器/网络，保留 named volume（数据一般还在）
docker compose down -v        # 连卷删除（练习数据清空，慎用）
```

### psql 内常用

```sql
SELECT 1;
\dt                 -- 列出表
SELECT * FROM rooms;
\q                  -- 退出
```

### 练习表（若库是空的可重做）

```sql
CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  area TEXT
);

INSERT INTO rooms (id, name, area)
VALUES ('room-001', '温馨客房', '四川省 · 成都市');

SELECT * FROM rooms;
```

---

## 和 room-booking 的关系（别混）

| 现在（学习） | 以后（项目） |
|--------------|--------------|
| 只跑 `db` | Compose：`api` + `db` |
| 手写 SQL 练手 | Express 用 `DATABASE_URL` 读写 |
| `store.json` 仍是线上真相 | 迁移脚本导入 PG 后淘汰 JSON |
| Admin 无关 | 仍本机 Vite，指向 API 端口 |

正式改 `server/` 业务代码、淘汰 JSON：另开开发 session / 再走 define→plan 亦可；**本学习线以 Docker 操作为主。**

---

## 部署大图（仅备忘，本阶段不做）

1. 本地 Compose 跑通 PG +（以后）API  
2. JSON → PostgreSQL  
3. 腾讯云轻量：同机 Docker 或装 PG；域名 + Let’s Encrypt（证书免费，域名通常仍要买）  
4. 小程序配置 request 合法域名  

---

## 常见坑

1. Docker Desktop 没开 → 命令全失败  
2. 5432 端口冲突 → 改映射端口  
3. `down -v` 会清空练习数据  
4. 用户/密码/库名必须和 compose 里 `POSTGRES_*` 一致  
