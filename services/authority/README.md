# Authority Center backend service

English | [中文](README.zh.md)

## Summary

The Authority Center is the Spring Boot service for the [Authorization Center product requirements](../../qishu/PRD/2-授权中心/授权中心.prd.md). It serves accounts, organizations, user groups, permission groups, application visibility authorization, login tokens, and audit logs. The API follows the [platform convention](../../qishu/PRD/平台公约.md): path prefix `/api/v1/auth`, the `{code,message,data}` response envelope, decimal strings for identifiers and `version`, and Beijing time truncated to seconds.

## Scope

- Implemented: accounts and passwords, organization structure, user groups and members, parameters and dictionaries, operation registration, permission groups and their associations, application authorization and permission checks, tokens and sessions, open capabilities, audit logs with 90-day cleanup.
- Not implemented: any management interface for application registration, approval, freezing, or retirement (the Application Center owns those), delegated authorization, permission refresh, center-side row-level data scope, and multi-tenancy.
- Standalone: the Authority Center handles registered applications and configured permissions without the Application Center being online.

## Layout

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

## Running

### Prerequisites

- Docker Desktop is running and `start.cmd` has been executed in `services/docker`, providing the PostgreSQL 18 instance.
- JDK 21 and Maven 3.9 are installed.

### Configuration

| Environment variable | Meaning |
| --- | --- |
| `AUTH_DB_URL` | Database connection, default `jdbc:postgresql://127.0.0.1:5432/qs` |
| `AUTH_DB_USER` | Database user, default `qs` |
| `AUTH_DB_PASSWORD` | Database password, taken from `POSTGRES_PASSWORD` in `services/docker/.env` |
| `AUTH_SUPER_PASSWORD` | Initial password of the built-in super admin, required on first bootstrap |
| `AUTH_SELF_APP_KEY` | AppKey of the center's own application, required on first bootstrap |
| `AUTH_APP_CENTER_KEY` | AppKey of the Application Center controlled identity, required on first bootstrap |

### Start

```bash
cd services/authority
AUTH_SUPER_PASSWORD='Admin@12345' AUTH_SELF_APP_KEY='self-console-key' AUTH_APP_CENTER_KEY='app-center-key' \
  scripts/run-local.sh
```

## API groups

| Prefix | Purpose |
| --- | --- |
| `/api/v1/auth/accounts` | Account create/read/update/delete, freeze and unfreeze, random password reset |
| `/api/v1/auth/organizations` | Organization create/read/update/delete and subtree moves |
| `/api/v1/auth/user-groups` | User groups and their members |
| `/api/v1/auth/parameters` | Parameters owned by the Authority Center |
| `/api/v1/auth/dictionaries` | Dictionaries owned by the Authority Center |
| `/api/v1/auth/permission-groups` | Permission groups and their operation sets |
| `/api/v1/auth/application-authorizations` | Application authorization records, visible permission groups, state sync |

The remaining paths are published in `/v3/api-docs`, Swagger UI at `/swagger-ui.html`, and Knife4j at `/doc.html`.

## Authorization model

Every request carries `X-App-Key`; endpoints that need a user identity also carry `Authorization: Bearer <token>`. The center checks in order whether the application is active, the token is valid, the account is not frozen, and the account is not inside the mandatory password change, then decides application visibility and operation permission.

- Ordinary accounts: visibility is the intersection of the permission groups the account obtains and the visible groups of the application, so any single hit grants visibility; function permission is the union of the operations inside the groups the account actually obtains.
- Built-in super admin: holds every registered application and function without any permission group, and still passes the AppKey, token, freeze, and initial-password-change checks.
- Management interfaces: the caller must be the center's own application, and the signed-in account must hold the matching registered operation while the center's own application is visible to it, using exactly the same decision as `POST /authorization-checks`; controlled interfaces accept only the configured Application Center AppKey.

## Testing

```bash
cd services/authority
AUTH_DB_PASSWORD='<POSTGRES_PASSWORD>' mvn -B test
```

Cases run against an isolated `qs_auth_test` database, start the real web container, and drive it over HTTP; the whole group skips itself when no local database is reachable.

## Development decisions

- Build and runtime: Spring Boot 4.1.1, Java 21, MyBatis 4.1.0, Flyway 12, PostgreSQL 18; the database version is provided by the Compose file in `services/docker`.
- API documentation: springdoc 3.1.1 generates OpenAPI and Knife4j contributes only its static interface, because the knife4j 4.5.0 starter pins springdoc 2.x, which targets Spring Boot 3.
- Tokens and passwords: passwords are BCrypt hashes, tokens are 256-bit random values stored only as SHA-256 digests, and AppSecret is stored as a digest and returned once when the authorization record is created.
- Management authorization: the center registers its own management operations under its own application (default `auth-center`, 64 operations) and authorizes management calls against them instead of role labels.
- Bootstrap: built-in identities and credentials come from environment variables, a missing credential fails startup, and restarting never overwrites existing accounts, applications, or operations.
- Time and version: `updated_at` and `version` are maintained by database triggers, and the account and organization triggers cover business columns only, so signing in or rewriting subtree paths never invalidates an editor's version.
- Audit and failure semantics: authorization decisions write their audit row inside the same transaction, so a failed write rolls back and returns no permission; for every other request the business write is already committed, so a failed audit write is logged and the real response is preserved instead of being reported as a failure. Audit columns are truncated to their real lengths, and bodies that cannot be parsed safely are omitted as a whole.

## Known limits and open product decisions

- Once an account has signed in it owns token rows, and the "never delete tokens along with the target" rule makes deletion return 40903; an account that never signed in and has no other association can be deleted.
- Requests that never reach `/api/v1/auth/**` routing, such as a wrong method on a read-only endpoint, do not enter the interceptor chain and therefore produce no audit row.
- Scene tokens cover issuance and authentication only; exchange and reconnection semantics remain an open item in the requirements.
- Service accounts cover account-type modelling and whitelist configuration validation only (whitelists are parsed as real addresses and prefixes): credential issuance, credential sign-in, and source-network matching are not implemented and wait on the open item in the requirements.
- Sign-in has no attempt limit or throttling, and the client IP is taken from the first `X-Forwarded-For` value: whether a gateway owns anti-enumeration and trusted-proxy validation is undecided and must be settled before production.
- Audit cleanup failures only log an error and wait for the next schedule; external alerting and failure-recovery drills have not been performed.
