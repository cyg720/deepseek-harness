#!/usr/bin/env python3
"""Generate synthetic JSON fixtures only; never connect to a business API or DB."""
import argparse
import hashlib
import json
from pathlib import Path
import random
import re


def generate(seed=20260912, namespace='prd-demo'):
    if not re.fullmatch(r'[a-z][a-z0-9-]{0,19}', namespace):
        raise ValueError('namespace requires 1-20 lowercase letters, digits or hyphens')
    rng = random.Random(seed)
    codes = [f'{namespace}-{n:06d}' for n in rng.sample(range(100000, 999999), 3)]
    devices = [dict(id=1001+i, code=codes[i], name=f'演示设备{i+1}', remark=None, version=1) for i in range(3)]
    return {
        'meta': {'synthetic': True, 'seed': seed, 'namespace': namespace,
                 'referenceTime': '2026-09-01T00:00:00Z',
                 'scopeMappingIsFixtureMetadata': True},
        'TD-01': {'devices': devices,
                  'actors': {'admin-a': {'role': 'admin', 'fixtureScope': 'A'},
                             'reader-a': {'role': 'reader', 'fixtureScope': 'A'}},
                  'scopeById': {'1001': 'A', '1002': 'A', '1003': 'B'}},
        'TD-02': {
            'validUpdate': {'id': 1001, 'name': '巡检设备A-更新', 'remark': '测试备注', 'version': 1},
            'staleUpdate': {'id': 1001, 'name': '不应覆盖', 'remark': '测试备注', 'version': 0},
            'validCreate': {'code': f'{namespace}-new', 'name': '新增演示设备', 'remark': None},
            'duplicateCreate': {'code': codes[0], 'name': '重复编码请求', 'remark': None},
            'blankName': {'code': f'{namespace}-blank', 'name': '   ', 'remark': None},
            'nameAtLimit': {'code': f'{namespace}-limit', 'name': 'A'*128, 'remark': None},
            'nameOverLimit': {'code': f'{namespace}-over', 'name': 'A'*129, 'remark': None},
            'remarkMissing': {'id': 1001, 'name': '字段语义', 'version': 1},
            'remarkNull': {'id': 1001, 'name': '字段语义', 'remark': None, 'version': 1},
            'remarkEmpty': {'id': 1001, 'name': '字段语义', 'remark': '', 'version': 1}},
        'TD-03': {'allowedDetailId': 1001, 'deniedDetailId': 1003,
                  'noMatchCode': f'{namespace}-missing', 'sortField': 'id;DROP TABLE x',
                  'untrustedName': '<img src="https://invalid.example/pixel" onerror="alert(1)">'},
        'TD-04': {'requestA': {'id': 1001, 'name': '并发甲', 'remark': None, 'version': 1},
                  'requestB': {'id': 1001, 'name': '并发乙', 'remark': None, 'version': 1}},
        'TD-05': {'transitions': [
            {'from': '[*]', 'event': '创建', 'to': '草稿'},
            {'from': '草稿', 'event': '启用', 'to': '启用'},
            {'from': '启用', 'event': '停用', 'to': '停用'},
            {'from': '停用', 'event': '重新启用', 'to': '启用'}],
            'invalidTransition': {'from': '草稿', 'event': '停用'}}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out-dir', required=True, type=Path)
    parser.add_argument('--seed', default=20260912, type=int)
    parser.add_argument('--namespace', default='prd-demo')
    args = parser.parse_args()
    fixtures = generate(args.seed, args.namespace)
    data = (json.dumps(fixtures, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    manifest = {'schemaVersion': 1, 'namespace': args.namespace, 'seed': args.seed,
                'file': 'device-fixtures.json', 'sha256': hashlib.sha256(data).hexdigest(),
                'datasetCount': 5, 'baselineRecords': 3,
                'validation': '合成数据清单；不代表已装载或业务测试通过'}
    outputs = {'device-fixtures.json': data,
               'manifest.json': (json.dumps(manifest, ensure_ascii=False, indent=2)+'\n').encode('utf-8')}
    args.out_dir.mkdir(parents=True, exist_ok=True)
    for name, content in outputs.items():
        path = args.out_dir/name
        if path.exists() and path.read_bytes() != content:
            raise SystemExit(f'Existing content differs; use a new isolated directory: {path}')
    for name, content in outputs.items():
        (args.out_dir/name).write_bytes(content)
    print(json.dumps(manifest, ensure_ascii=False))


if __name__ == '__main__':
    main()
