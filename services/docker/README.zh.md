# 本机 Docker 基础服务

[English](README.md) | 中文

## Summary

本目录为 Windows 本机开发提供 Redis、PostgreSQL、RustFS 和 Nginx。双击脚本即可统一启停；数据库、缓存和对象文件通过 Docker 命名卷保存。所有映射端口仅监听 `127.0.0.1`。

## Table of Contents

- [启动与停止](#start-and-stop)
- [连接配置](#connections)
- [配置与扩展](#configuration-and-extensions)
- [排错](#troubleshooting)

## Start and stop

1. 打开 Docker Desktop，使用 Linux 容器模式。
2. 双击 [start.cmd](start.cmd)。首次启动会从 [.env.example](.env.example) 创建 `.env`，生成三个独立随机密码，并拉取缺失镜像。脚本在四个服务健康后报告成功。
3. 双击 [stop.cmd](stop.cmd) 停止并移除本项目容器和网络，保留数据卷。

终端中可在本目录运行以下命令；`--no-pause` 用于执行结束后直接退出。脚本也支持从其他工作目录通过完整路径调用。

```powershell
.\start.cmd --no-pause
.\stop.cmd --no-pause
```

## Connections

下表对应默认端口；密码在本目录自动生成的 `.env` 中，该文件已被仓库忽略。

| 服务 | 本机地址 | 账号 / 数据库 | 密码配置项 |
| --- | --- | --- | --- |
| Redis | `127.0.0.1:6379` | 默认用户 | `REDIS_PASSWORD` |
| PostgreSQL | `127.0.0.1:5432` | 用户 `qs`，数据库 `qs` | `POSTGRES_PASSWORD` |
| RustFS S3 API | `http://127.0.0.1:9000` | Access Key `qsadmin` | `RUSTFS_SECRET_KEY` |
| RustFS 控制台 | <http://127.0.0.1:9001> | `qsadmin` | `RUSTFS_SECRET_KEY` |
| Nginx | <http://127.0.0.1:8080> | 无 | 无 |

Nginx 提供文本首页及 `/health`，业务反向代理配置放在 [nginx/conf.d/default.conf](nginx/conf.d/default.conf)。它不代理数据库或 RustFS。

## Configuration and extensions

修改 `.env` 可调整端口、账号和镜像，再运行启动脚本。首次启动前如需自定义，可复制 `.env.example` 为 `.env`，并手动替换全部 `__GENERATE_...__` 密码标记；已有 `.env` 不会被脚本覆盖。保留 `.env` 和 `COMPOSE_PROJECT_NAME`，以便后续启动继续使用相同项目及数据卷。

PostgreSQL 的用户、密码和数据库环境变量仅初始化空数据卷；已有数据库改密应通过 SQL 操作。不要仅修改 `.env` 后期待数据库密码同步改变。PostgreSQL 18 的数据卷挂载到 `/var/lib/postgresql`；切换主版本需要专门迁移数据。

在 [docker-compose.yml](docker-compose.yml) 的 `services` 下新增服务，并按需声明 `volumes` 和健康检查，即可复用启停脚本。服务默认共享本项目网络；容器之间使用服务名和容器端口，例如 `postgres:5432`、`redis:6379`、`rustfs:9000`。容器访问宿主机应用可使用 Docker Desktop 的 `host.docker.internal`。

普通启动复用本地镜像，缺失时才拉取。RustFS 的 `latest` 和 Nginx 的 `stable-alpine` 是浮动标签；需要可复现环境时，在 `.env` 中指定验证过的版本或摘要。Redis 启用 AOF；命名卷由 Docker Desktop 管理，停止脚本不删除它们。`docker compose down -v` 会删除数据，不能作为日常停止命令。

## Troubleshooting

在本目录运行以下命令，分别检查配置、查看容器和读取日志；避免分享包含密码的完整 `docker compose config` 输出。

```powershell
docker compose config --quiet
docker compose ps --all
docker compose logs --tail 100
```

启动失败时，脚本保留容器便于排查。端口冲突可通过修改 `.env` 中的端口解决；拉取失败需检查 Docker Desktop 的网络或镜像仓库连接，再重新启动。健康等待上限为 180 秒，不包含镜像下载时间。

## Further Exploration

- [PostgreSQL 官方镜像的数据目录说明](https://hub.docker.com/_/postgres)
- [RustFS 官方 Compose 示例](https://github.com/rustfs/rustfs/blob/main/docker-compose.yml)
- [Docker Compose 启动及健康等待选项](https://docs.docker.com/reference/cli/docker/compose/up/)

## Dev Note

无。
