#!/usr/bin/env bash
# 本地启动授权中心：从 services/docker/.env 读取数据库口令，其余凭据由调用方以环境变量提供。
#
# 用法：
#   AUTH_SUPER_PASSWORD=... AUTH_SELF_APP_KEY=... AUTH_APP_CENTER_KEY=... scripts/run-local.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_DIR="$(dirname "$SCRIPT_DIR")"
DOCKER_ENV="$SERVICE_DIR/../docker/.env"

if [[ -z "${AUTH_DB_PASSWORD:-}" && -f "$DOCKER_ENV" ]]; then
  AUTH_DB_PASSWORD="$(grep '^POSTGRES_PASSWORD=' "$DOCKER_ENV" | cut -d= -f2-)"
  export AUTH_DB_PASSWORD
fi

for name in AUTH_SUPER_PASSWORD AUTH_SELF_APP_KEY AUTH_APP_CENTER_KEY; do
  if [[ -z "${!name:-}" ]]; then
    echo "缺少环境变量 $name；初始化内置身份需要这三个凭据" >&2
    exit 1
  fi
done

cd "$SERVICE_DIR"
exec mvn -q -B spring-boot:run
