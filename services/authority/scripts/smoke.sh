#!/usr/bin/env bash
# 授权中心接口冒烟：覆盖每个模块至少一个端点，用于开发期快速发现装配问题。
# 用法：BASE=http://127.0.0.1:8090 SELF_KEY=... ADMIN_PASSWORD=... scripts/smoke.sh
set -uo pipefail

BASE="${BASE:-http://127.0.0.1:8090}"
API="$BASE/api/v1/auth"
SELF_KEY="${SELF_KEY:?需要 SELF_KEY}"
CENTER_KEY="${CENTER_KEY:?需要 CENTER_KEY}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:?需要 ADMIN_PASSWORD}"
SUFFIX="$(date +%s)"

json() { python -c "import json,sys;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$1"; }

# 请求体统一经临时文件发送：Git Bash 会把命令行参数转成系统代码页，
# 直接内联中文会让服务端收到非 UTF-8 报文。
BODY_FILE="$(mktemp)"
trap 'rm -f "$BODY_FILE"' EXIT

call() {
  local method="$1" path="$2" token="$3" body="$4" extra="${5:-}"
  local args=(-s -X "$method" "$API$path" -H 'Content-Type: application/json')
  [ -n "$token" ] && args+=(-H "Authorization: Bearer $token")
  [ -n "$SELF_KEY" ] && args+=(-H "X-App-Key: $APP_KEY")
  [ -n "$extra" ] && args+=(-H "$extra")
  if [ -n "$body" ]; then
    printf '%s' "$body" > "$BODY_FILE"
    args+=(--data-binary "@$BODY_FILE")
  fi
  curl "${args[@]}"
}

step() { printf '\n=== %s ===\n' "$1"; }

APP_KEY="$SELF_KEY"
step "管理员登录"
LOGIN=$(call POST /sessions/login "" "{\"username\":\"admin\",\"password\":\"$ADMIN_PASSWORD\"}")
echo "$LOGIN"
TOKEN=$(echo "$LOGIN" | json "d['data']['token']")

if [ "$(echo "$LOGIN" | json "d['data']['mustChangePassword']")" = "True" ]; then
  step "改密前的普通业务调用（期望 40303）"
  call GET "/accounts?page=1" "$TOKEN" ""

  step "首次强制改密"
  call POST /initial-password-changes "$TOKEN" "{\"newPassword\":\"Admin@2026x\"}"

  step "改密后旧令牌应失效（期望 40103）"
  call GET "/accounts?page=1" "$TOKEN" ""

  step "用新密码重新登录"
  LOGIN=$(call POST /sessions/login "" "{\"username\":\"admin\",\"password\":\"Admin@2026x\"}")
  echo "$LOGIN"
  TOKEN=$(echo "$LOGIN" | json "d['data']['token']")
else
  echo "（管理员已完成首次改密，跳过强制改密演示；该场景由成员账号覆盖）"
fi

step "新建组织（根 + 子）"
ORG_ROOT=$(call POST /organizations "$TOKEN" "{\"orgName\":\"总部-$SUFFIX\",\"orgType\":\"company\"}")
echo "$ORG_ROOT"
ORG_ID=$(echo "$ORG_ROOT" | json "d['data']['id']")
ORG_CHILD=$(call POST /organizations "$TOKEN" "{\"parentId\":\"$ORG_ID\",\"orgName\":\"研发部-$SUFFIX\",\"orgType\":\"department\"}")
echo "$ORG_CHILD"
ORG_CHILD_ID=$(echo "$ORG_CHILD" | json "d['data']['id']")

step "组织防环（把根移到自己的子节点下）"
call PATCH "/organizations/$ORG_ID" "$TOKEN" "{\"version\":\"1\",\"parentId\":\"$ORG_CHILD_ID\"}"

step "新建账号"
ACCOUNT=$(call POST /accounts "$TOKEN" "{\"username\":\"smoke-$SUFFIX\",\"password\":\"Member@123\",\"phone\":\"1390000${SUFFIX: -4}\"}")
echo "$ACCOUNT"
ACCOUNT_ID=$(echo "$ACCOUNT" | json "d['data']['id']")

step "账号列表（分页与筛选）"
call GET "/accounts?page=1&pageSize=5&status=normal" "$TOKEN" ""

step "未知查询参数应 40001"
call GET "/accounts?unknownField=1" "$TOKEN" ""

step "应用中心登记应用"
APP_KEY="$CENTER_KEY"
APP=$(call POST /application-authorizations "" "{\"appCode\":\"app-a-$SUFFIX\"}")
echo "$APP"
APP_ID=$(echo "$APP" | json "d['data']['id']")
APP_AK=$(echo "$APP" | json "d['data']['appKey']")

step "上报操作"
OP=$(call POST /operations "" "{\"appCode\":\"app-a-$SUFFIX\",\"operationCode\":\"app-a-$SUFFIX.DeviceController.list\",\"operationName\":\"list\"}")
echo "$OP"
OP_ID=$(echo "$OP" | json "d['data']['id']")

step "前缀错误应 40001"
call POST /operations "" "{\"appCode\":\"app-a-$SUFFIX\",\"operationCode\":\"DeviceController.list\",\"operationName\":\"list\"}"

APP_KEY="$SELF_KEY"
step "新建权限组并绑定操作"
GROUP=$(call POST /permission-groups "$TOKEN" "{\"name\":\"组-$SUFFIX\",\"operationIds\":[\"$OP_ID\"]}")
echo "$GROUP"
GROUP_ID=$(echo "$GROUP" | json "d['data']['id']")

step "配置应用可见权限组"
call PATCH "/application-authorizations/$APP_ID" "$TOKEN" "{\"version\":\"1\",\"permissionGroupIds\":[\"$GROUP_ID\"]}"

step "用户关联权限组 / 组织关联权限组"
call POST /account-permission-groups "$TOKEN" "{\"permissionGroupId\":\"$GROUP_ID\",\"accountId\":\"$ACCOUNT_ID\"}"
call POST /organization-permission-groups "$TOKEN" "{\"permissionGroupId\":\"$GROUP_ID\",\"orgId\":\"$ORG_ID\"}"

step "账号关联组织 / 用户组成员"
call POST /account-organizations "$TOKEN" "{\"accountId\":\"$ACCOUNT_ID\",\"orgId\":\"$ORG_ID\"}"
UG=$(call POST /user-groups "$TOKEN" "{\"groupCode\":\"ug-$SUFFIX\",\"groupName\":\"跨部门组-$SUFFIX\"}")
echo "$UG"
UG_ID=$(echo "$UG" | json "d['data']['id']")
call POST /user-group-memberships "$TOKEN" "{\"userGroupId\":\"$UG_ID\",\"accountId\":\"$ACCOUNT_ID\"}"

step "参数与字典"
call POST /parameters "$TOKEN" "{\"paramCode\":\"p-$SUFFIX\",\"paramValue\":\"42\"}"
call POST /dictionaries "$TOKEN" "{\"dictCode\":\"d-$SUFFIX\",\"dictItems\":[\"启用\",\"禁用\"]}"

step "成员登录并改初始密码"
MEMBER_LOGIN=$(call POST /sessions/login "" "{\"username\":\"smoke-$SUFFIX\",\"password\":\"Member@123\"}")
echo "$MEMBER_LOGIN"
MEMBER_TOKEN=$(echo "$MEMBER_LOGIN" | json "d['data']['token']")
call POST /initial-password-changes "$MEMBER_TOKEN" "{\"newPassword\":\"Member@456\"}"
MEMBER_LOGIN=$(call POST /sessions/login "" "{\"username\":\"smoke-$SUFFIX\",\"password\":\"Member@456\"}")
MEMBER_TOKEN=$(echo "$MEMBER_LOGIN" | json "d['data']['token']")

step "鉴权：允许"
call POST /authorization-checks "$MEMBER_TOKEN" "{\"operationCode\":\"app-a-$SUFFIX.DeviceController.list\"}" "X-App-Key: $APP_AK"

step "鉴权：未登记操作应 40301"
call POST /authorization-checks "$MEMBER_TOKEN" "{\"operationCode\":\"app-a-$SUFFIX.DeviceController.delete\"}"

step "开放能力：当前用户详情与权限"
call GET /users/me "$MEMBER_TOKEN" ""
call GET "/users/me/permissions?appCode=app-a-$SUFFIX" "$MEMBER_TOKEN" ""

step "换发窗口外应 40904"
call POST /sessions/renew "$MEMBER_TOKEN" ""

step "冻结账号后鉴权应 40302"
ACC_VERSION=$(call GET "/accounts/$ACCOUNT_ID" "$TOKEN" "" | json "d['data']['version']")
call POST "/accounts/$ACCOUNT_ID/freeze" "$TOKEN" "{\"version\":\"$ACC_VERSION\"}"
call POST /authorization-checks "$MEMBER_TOKEN" "{\"operationCode\":\"app-a-$SUFFIX.DeviceController.list\"}"
call POST "/accounts/$ACCOUNT_ID/unfreeze" "$TOKEN" "{\"version\":\"$((ACC_VERSION+1))\"}"

step "应用冻结后鉴权应 40302"
APP_KEY="$CENTER_KEY"
APP_VERSION=$(call GET "/application-authorizations/$APP_ID" "" "" | json "d['data']['version']")
call POST "/application-authorizations/$APP_ID/state-sync" "" "{\"status\":\"frozen\",\"version\":\"$APP_VERSION\"}"
call POST /authorization-checks "$MEMBER_TOKEN" "{\"operationCode\":\"app-a-$SUFFIX.DeviceController.list\"}" "X-App-Key: $APP_AK"
call POST "/application-authorizations/$APP_ID/state-sync" "" "{\"status\":\"active\",\"version\":\"$((APP_VERSION+1))\"}"

step "有引用的权限组删除应 40903"
APP_KEY="$SELF_KEY"
GROUP_VERSION=$(call GET "/permission-groups/$GROUP_ID" "$TOKEN" "" | json "d['data']['version']")
call DELETE "/permission-groups/$GROUP_ID?version=$GROUP_VERSION" "$TOKEN" ""

step "审计日志列表"
APP_KEY="$SELF_KEY"
call GET "/audit-logs?page=1&pageSize=3" "$TOKEN" ""

step "退出当前设备"
call POST /sessions/logout "$MEMBER_TOKEN" ""
call POST /sessions/logout "$MEMBER_TOKEN" ""

printf '\n=== 冒烟结束 ===\n'
