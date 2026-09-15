# Local Docker infrastructure

English | [中文](README.zh.md)

## Summary

This directory provides Redis, PostgreSQL, RustFS, and Nginx for local Windows development. Double-click the scripts to start or stop the services together; Docker named volumes retain databases, cache data, and objects. All published ports listen only on `127.0.0.1`.

## Table of Contents

- [Start and stop](#start-and-stop)
- [Connections](#connections)
- [Configuration and extensions](#configuration-and-extensions)
- [Troubleshooting](#troubleshooting)

## Start and stop

1. Open Docker Desktop in Linux container mode.
2. Double-click [start.cmd](start.cmd). The first start creates `.env` from [.env.example](.env.example), generates three independent random passwords, and pulls missing images. The script reports success when all four services are healthy.
3. Double-click [stop.cmd](stop.cmd) to stop and remove this project's containers and network while retaining data volumes.

Run the following commands from this directory in a terminal; `--no-pause` exits immediately after execution. The scripts also accept invocation by absolute path from another working directory.

```powershell
.\start.cmd --no-pause
.\stop.cmd --no-pause
```

## Connections

The table lists default ports; passwords are stored in the automatically generated `.env` in this directory, which the repository ignores.

| Service | Local address | Account / database | Password setting |
| --- | --- | --- | --- |
| Redis | `127.0.0.1:6379` | Default user | `REDIS_PASSWORD` |
| PostgreSQL | `127.0.0.1:5432` | User `qs`, database `qs` | `POSTGRES_PASSWORD` |
| RustFS S3 API | `http://127.0.0.1:9000` | Access Key `qsadmin` | `RUSTFS_SECRET_KEY` |
| RustFS console | <http://127.0.0.1:9001> | `qsadmin` | `RUSTFS_SECRET_KEY` |
| Nginx | <http://127.0.0.1:8080> | None | None |

Nginx serves a text index and `/health`; place application reverse proxy configuration in [nginx/conf.d/default.conf](nginx/conf.d/default.conf). It does not proxy databases or RustFS.

## Configuration and extensions

Edit `.env` to change ports, accounts, or images, then run the start script. To customize before the first start, copy `.env.example` to `.env` and manually replace every `__GENERATE_...__` password marker; the script never overwrites an existing `.env`. Retain `.env` and `COMPOSE_PROJECT_NAME` so subsequent starts use the same project and data volumes.

PostgreSQL user, password, and database environment variables initialize empty data volumes only; change an existing database password through SQL. Editing `.env` alone does not change the database password. PostgreSQL 18 mounts its data volume at `/var/lib/postgresql`; changing major versions requires a separate data migration.

Add services under `services` in [docker-compose.yml](docker-compose.yml), declaring `volumes` and health checks as needed, to reuse the start and stop scripts. Services share this project's default network; containers communicate using service names and container ports, such as `postgres:5432`, `redis:6379`, and `rustfs:9000`. Containers can reach host applications through Docker Desktop's `host.docker.internal`.

Normal starts reuse local images and pull only missing ones. RustFS `latest` and Nginx `stable-alpine` are floating tags; set verified versions or digests in `.env` when reproducibility is required. Redis enables AOF; Docker Desktop manages named volumes, and the stop script preserves them. `docker compose down -v` deletes data and must not be used for routine stops.

## Troubleshooting

Run these commands from this directory to validate configuration, inspect containers, and read logs; avoid sharing full `docker compose config` output because it contains passwords.

```powershell
docker compose config --quiet
docker compose ps --all
docker compose logs --tail 100
```

On startup failure, the script retains containers for diagnosis. Resolve port conflicts by editing ports in `.env`; for pull failures, check Docker Desktop networking or registry connectivity, then retry the start script. The health wait limit is 180 seconds, excluding image downloads.

## Further Exploration

- [PostgreSQL official image data directory guidance](https://hub.docker.com/_/postgres)
- [RustFS official Compose example](https://github.com/rustfs/rustfs/blob/main/docker-compose.yml)
- [Docker Compose startup and health wait options](https://docs.docker.com/reference/cli/docker/compose/up/)

## Dev Note

None.
