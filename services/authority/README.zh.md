# 授权中心后端服务

[English](README.md) | 中文

## 概述

授权中心是[授权中心产品需求文档](../../qishu/PRD/2-授权中心/授权中心.prd.md)对应的 Spring Boot 服务，提供账号、组织、用户组、权限组、应用可见范围授权、登录令牌与审计日志接口。接口遵循[平台公约](../../qishu/PRD/平台公约.md)：路径前缀 `/api/v1/auth`，统一响应 `{code,message,data}`，标识与 version 用十进制字符串，时间统一北京时间秒精度。

## 服务范围

- 已实现：账号与口令、组织结构、用户组与成员、参数与字典、操作登记、权限组与关联、应用授权与鉴权、令牌与会话、开放能力、审计日志与 90 天清理。
- 不实现：应用注册、审批、冻结与下线的管理界面（由应用中心负责），委托授权、权限刷新、中心行级数据权限、多租户。
- 独立运行：授权中心不依赖应用中心在线即可处理已登记的应用与已配置的权限。

## 目录结构

```text
services/authority
├── pom.xml
├── scripts/            local start, end-to-end smoke, and database schema verification
├── docs/               delivery notes and acceptance report
└── src
    ├── main/java/com/qs/authority
    │   ├── bootstrap/  controlled bootstrap: built-in super admin, own app and operations, app-center identity
    │   ├── common/     response envelope, error codes, exception outlet, PATCH semantics, paging, Beijing time, tracing
    │   ├── config/     deployment configuration, web wiring, API documentation
    │   ├── modules/    business modules (controller, service, mapper, DTO)
    │   └── security/   AppKey, tokens, permission computation, management-interface guards
    ├── main/resources
    │   ├── application.yml
    │   ├── db/migration/   Flyway schema scripts
    │   └── mapper/         MyBatis SQL mappings
    └── test/java       HTTP acceptance cases and the test base class
```

## 运行

### 前置条件

- Docker Desktop 已启动，并在 `services/docker` 目录执行过 `start.cmd`，得到 PostgreSQL 18 实例。
- 本机具备 JDK 21 与 Maven 3.9。

### 配置

| 环境变量 | 说明 |
| --- | --- |
| `AUTH_DB_URL` | 数据库连接，默认 `jdbc:postgresql://127.0.0.1:5432/qs` |
| `AUTH_DB_USER` | 数据库用户，默认 `qs` |
| `AUTH_DB_PASSWORD` | 数据库口令，取自 `services/docker/.env` 的 `POSTGRES_PASSWORD` |
| `AUTH_SUPER_PASSWORD` | 内置超级管理员初始口令，首次初始化必填 |
| `AUTH_SELF_APP_KEY` | 授权中心自身应用的 AppKey，首次初始化必填 |
| `AUTH_APP_CENTER_KEY` | 应用中心受控身份 AppKey，首次初始化必填 |

### 启动

```bash
cd services/authority
AUTH_SUPER_PASSWORD='Admin@12345' AUTH_SELF_APP_KEY='self-console-key' AUTH_APP_CENTER_KEY='app-center-key' \
  scripts/run-local.sh
```

## 接口分组

| 前缀 | 说明 |
| --- | --- |
| `/api/v1/auth/accounts` | 账号增改删查、冻结解冻、随机重置密码 |
| `/api/v1/auth/organizations` | 组织增改删查与子树移动 |
| `/api/v1/auth/user-groups` | 用户组与成员关系 |
| `/api/v1/auth/parameters` | 授权中心自身参数 |
| `/api/v1/auth/dictionaries` | 授权中心自身字典 |
| `/api/v1/auth/permission-groups` | 权限组及其操作集合 |
| `/api/v1/auth/application-authorizations` | 应用授权记录、可见权限组与状态同步 |

其余路径见 `/v3/api-docs`、Swagger UI `/swagger-ui.html` 与 Knife4j `/doc.html`。

## 鉴权模型

每次请求都必须携带 `X-App-Key`，需要用户身份的接口再带 `Authorization: Bearer <token>`。授权中心依次检查应用是否生效、令牌是否有效、账号是否冻结、是否处于强制改密阶段，再判断应用可见性与操作权限。

- 普通账号：应用可见性来自“用户取得的权限组”与“应用关联的可见权限组”的交集，命中任一组即可见；功能权限取用户实际取得组内操作的并集。
- 内置超级管理员：不参与权限组即拥有全部已登记应用与功能，但仍要经过 AppKey、令牌、冻结与首次改密检查。
- 管理接口：调用方必须是授权中心自身应用，且登录账号在“授权中心自身应用对其可见”的前提下拥有对应已登记操作；判定与 `POST /authorization-checks` 完全一致。应用中心受控接口只接受配置的应用中心 AppKey。

## 测试

```bash
cd services/authority
AUTH_DB_PASSWORD='<POSTGRES_PASSWORD>' mvn -B test
```

用例在独立测试库 `qs_auth_test` 上运行，启动真实 Web 容器并走 HTTP 请求；本地没有可用数据库时整组自动跳过。

## 已做的开发决定

- 构建与运行：Spring Boot 4.1.1、Java 21、MyBatis 4.1.0、Flyway 12、PostgreSQL 18；数据库版本由 `services/docker` 的 Compose 提供。
- 接口文档：springdoc 3.1.1 生成 OpenAPI，Knife4j 只使用其静态界面；knife4j 4.5.0 的 starter 固定依赖面向 Spring Boot 3 的 springdoc 2.x，因此不引入。
- 令牌与口令：口令使用 BCrypt 散列，令牌为 256 位随机值且只存 SHA-256 摘要，AppSecret 只存摘要并仅在建立授权记录时返回一次。
- 管理接口鉴权：授权中心把自身管理操作登记到自己的应用下（默认 `auth-center`，共 64 项），管理接口按这些操作鉴权，而不是靠角色标签。
- 初始化：内置身份与凭据全部来自环境变量，缺失时启动失败；重复启动不覆盖已有账号、应用或操作。
- 时间与版本：更新时间与 version 由数据库触发器维护，账号与组织的触发器只覆盖业务列，登录与子树路径重写不会使编辑版本失效。
- 审计与失败语义：授权判定在同一事务内写审计，写失败即回滚且不返回许可；其余请求的业务已经提交，审计写失败只记录错误日志并保留真实响应，不改判为失败。审计字段按数据库列长截断，无法安全解析的正文整体省略。

## 已知限制与待产品确认

- 账号一经登录即产生令牌记录，按“删除不连带 token”的规则会被 40903 阻止删除；从未登录且无其他关联的账号可以删除。
- 未路由到 `/api/v1/auth/**` 的请求（例如对只读接口使用错误方法）不进入拦截器链，因此不产生审计记录。
- 场景令牌只完成签发与鉴权，兑换与重连语义仍按 PRD 的待定项处理。
- 服务账号只完成账号类型建模与白名单配置校验（白名单按真实地址与网段解析）：凭据签发、凭据登录与请求来源网段匹配尚未实现，等待 PRD 的待定项。
- 登录没有失败次数限制与节流，客户端 IP 直接取 `X-Forwarded-For` 首值：是否由网关承担抗枚举与可信代理校验未定，生产部署前需明确。
- 审计清理失败只写错误日志并等待下一次调度，外部告警接入与故障恢复演练尚未执行。
