"""生成应用中心PRD的本地合成JSON；不连接数据库或业务服务。"""
import argparse
import hashlib
import json
from pathlib import Path

FIXED_TIME = "2026-09-14 10:00:00"
SEED = 3101


def generate():
    """返回固定顺序、固定参数的数据；测试身份不是实际账号。"""
    actors = [
        {"id": "101", "role": "owner", "teamIds": ["201"]},
        {"id": "102", "role": "reviewer", "teamIds": ["201"]},
        {"id": "103", "role": "viewer", "teamIds": ["201"]},
        {"id": "104", "role": "outsider", "teamIds": ["202"]},
        {"id": "105", "role": "operator", "teamIds": ["201"]},
        {"id": "106", "role": "service", "teamIds": []},
    ]
    apps = []
    for i, state in enumerate(["draft", "pending", "published", "frozen", "offline"], 1):
        remote = {"draft": None, "pending": None, "published": "active", "frozen": "frozen", "offline": "offline"}[state]
        apps.append({"id": str(1000 + i), "app_code": "prd_app_" + state,
                     "app_name": "合成应用" + str(i), "logo": None, "cover": None,
                     "scope": "team", "owner_id": "101", "team_id": "201", "status": state,
                     "release_version": "1.0.0", "version": "7", "description": "仅供需求验证",
                     "dependencies": [{"kind": "plugin", "code": "prd_plugin", "version": "2.0.0"}],
                     "authorization_id": str(2000 + i) if remote else None,
                     "app_key": None, "credential_ref": None,
                     "desired_auth_status": remote or "offline", "observed_auth_status": remote,
                     "observed_auth_version": "3" if remote else None,
                     "created_at": FIXED_TIME, "updated_at": FIXED_TIME,
                     "created_by": "101", "updated_by": "101"})
    invalid = [
        {"name": "name_null", "patch": {"version": "7", "appName": None}, "code": 40001},
        {"name": "name_blank", "patch": {"version": "7", "appName": "   "}, "code": 40001},
        {"name": "name_long", "patch": {"version": "7", "appName": "中" * 129}, "code": 40001},
        {"name": "dependencies_null", "patch": {"version": "7", "dependencies": None}, "code": 40001},
        {"name": "dependencies_object", "patch": {"version": "7", "dependencies": {}}, "code": 40001},
        {"name": "readonly", "patch": {"version": "7", "appSecret": "synthetic-not-a-secret"}, "code": 40001},
        {"name": "stale_version", "patch": {"version": "6", "appName": "过期修改"}, "code": 40901},
        {"name": "no_change", "patch": {"version": "7"}, "code": 40001},
    ]
    data = {"metadata": {"seed": SEED, "time": FIXED_TIME, "namespace": "prd_app_", "synthetic": True},
            "TD-01": {"actors": actors, "applications": apps},
            "TD-02": {"requests": invalid, "validName128": "中" * 128, "bigId": "9007199254740993"},
            "TD-03": {"dependencyStates": ["available", "missing", "disabled", "version_mismatch", "timeout"],
                      "syncFaults": ["before_send", "response_lost", "version_conflict", "worker_restart", "old_active_after_freeze"]},
            "TD-04": {"page": {"page": 1, "pageSize": 20}, "pageSizeInvalid": [0, 101],
                      "references": ["review", "authorization", "sync_job"],
                      "legalTransitions": [["draft", "submit", "pending"], ["pending", "withdraw", "draft"],
                                           ["pending", "reject", "draft"], ["pending", "approve", "published"],
                                           ["published", "freeze", "frozen"], ["frozen", "enable", "published"],
                                           ["published", "offline", "offline"], ["frozen", "offline", "offline"],
                                           ["offline", "enable", "published"], ["offline", "revise", "draft"]]}}
    assert len(apps) == 5 and len(invalid) == 8
    assert len({a["app_code"] for a in apps}) == 5
    assert all(a["owner_id"] in {p["id"] for p in actors} for a in apps)
    assert all(a["scope"] == "team" and a["team_id"] == "201" for a in apps)
    assert all(isinstance(a["dependencies"], list) and int(a["version"]) > 0 for a in apps)
    assert len(data["TD-04"]["legalTransitions"]) == 10
    return data


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out-dir", required=True, type=Path)
    args = parser.parse_args()
    args.out_dir.mkdir(parents=True, exist_ok=True)
    raw = (json.dumps(generate(), ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    target = args.out_dir / "application-fixtures.json"
    if target.exists() and target.read_bytes() != raw:
        raise SystemExit("拒绝覆盖不同内容；请使用新的输出目录")
    target.write_bytes(raw)
    print(json.dumps({"file": str(target), "sha256": hashlib.sha256(raw).hexdigest(), "datasets": 4}, ensure_ascii=False))
