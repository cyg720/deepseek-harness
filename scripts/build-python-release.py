#!/usr/bin/env python3
"""Stage and build one Python wheel at the repository version."""
# 文件职责：实现 build-python-release.py 覆盖的Python 发布或平台校验脚本职责。
# 技术维度：使用 Python、异步 I/O、JSON-RPC、构建后端或标准库文件与进程接口。
# 产品维度：保障 Agent 的Python 发布或平台校验脚本能力可安装、可调用且可诊断。
# 逻辑维度：解析参数或数据，执行核心调用或校验，再返回结果并处理资源清理。
# 关键边界：外部进程与文件不可信；版本和平台条件必须显式；敏感环境变量不得泄露。
# 新手阅读建议：先看导入和公开类型，再读主流程，最后关注异常、平台差异和清理。

from __future__ import annotations

import argparse
import email
import json
import os
import re
import shutil
import stat
import subprocess
import tempfile
import zipfile
from pathlib import Path


# 中文说明：常量 ROOT 保存本模块共享的固定值；取值由紧邻初始化或后续赋值决定。
ROOT = Path(__file__).resolve().parents[1]
# 中文说明：常量 SDK_DISTRIBUTION 保存本模块共享的固定值；取值由紧邻初始化或后续赋值决定。
SDK_DISTRIBUTION = "deepseek-harness-sdk"
# 中文说明：常量 RUNTIME_DISTRIBUTION 保存本模块共享的固定值；取值由紧邻初始化或后续赋值决定。
RUNTIME_DISTRIBUTION = "deepseek-harness-runtime-bin"
# 中文说明：常量 PLATFORM_MANIFEST 保存本模块共享的固定值；取值由紧邻初始化或后续赋值决定。
PLATFORM_MANIFEST = ROOT / "python" / "sdk-runtime" / "platforms.json"


# 中文说明：函数 load_platforms 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def load_platforms(path: Path = PLATFORM_MANIFEST) -> dict[str, tuple[str, str]]:
    """Load the release platform tag and executable pairs from the build manifest."""
    try:
        # 中文说明：变量 payload 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        payload = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"could not read runtime platform manifest from {path}") from error
    if not isinstance(payload, dict) or not payload:
        raise ValueError(f"{path} must contain a non-empty platform object")
    # 中文说明：变量 platforms 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    platforms: dict[str, tuple[str, str]] = {}
    # 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。
    for name, raw in payload.items():
        if (
            not isinstance(name, str)
            or not isinstance(raw, dict)
            or set(raw) != {"tag", "executable"}
            or not isinstance(raw["tag"], str)
            or not isinstance(raw["executable"], str)
        ):
            raise ValueError(f"{path} platform entries must contain string tag and executable fields")
        platforms[name] = (raw["tag"], raw["executable"])
    return platforms


# 中文说明：常量 PLATFORMS 保存本模块共享的固定值；取值由紧邻初始化或后续赋值决定。
PLATFORMS = load_platforms()


# 中文说明：函数 runtime_suffixes 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def runtime_suffixes(executable_name: str) -> tuple[str, ...]:
    # 中文说明：变量 suffixes 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    suffixes = ("", "-rg")
    return (*suffixes, "-spawn-helper") if "-macos-" in executable_name else suffixes


# 中文说明：函数 main 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def main() -> None:
    # 中文说明：变量 parser 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", choices=("sdk", "runtime"), required=True)
    parser.add_argument(
        "--tag",
        # 中文说明：变量 help 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        help="optional python-v<repository-version> release tag; it must match package.json",
    )
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--platform", choices=tuple(PLATFORMS))
    parser.add_argument("--runtime-exe", type=Path)
    # 中文说明：变量 args 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    args = parser.parse_args()
    # 中文说明：变量 version 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    version = repository_version()
    validate_release_tag(args.tag, version)
    # Wheels carry the PEP 440 spelling; the tag keeps the repository spelling.
    # 中文说明：变量 wheel_version 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    wheel_version = pep440_version(version)
    if args.package == "runtime" and (args.platform is None or args.runtime_exe is None):
        parser.error("runtime builds require --platform and --runtime-exe")
    if args.package == "sdk" and (args.platform is not None or args.runtime_exe is not None):
        parser.error("SDK builds do not accept --platform or --runtime-exe")

    # 中文说明：变量 output_dir 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="dsh-python-release-") as temporary:
        # 中文说明：变量 staging 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        staging = Path(temporary) / args.package
        if args.package == "sdk":
            stage_sdk(staging, wheel_version)
            # 中文说明：变量 environment 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            environment = None
            # 中文说明：变量 expected 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            expected = output_dir / f"deepseek_harness_sdk-{wheel_version}-py3-none-any.whl"
        else:
            platform_tag, executable_name = PLATFORMS[args.platform]
            stage_runtime(staging, wheel_version, args.runtime_exe.resolve(), executable_name)
            # 中文说明：变量 environment 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            environment = {"DSH_RUNTIME_PLATFORM_TAG": platform_tag}
            # 中文说明：变量 expected 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            expected = output_dir / f"deepseek_harness_runtime_bin-{wheel_version}-py3-none-{platform_tag}.whl"
        # 中文说明：变量 command 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        command = ["uv", "build", "--wheel", "--out-dir", str(output_dir), str(staging)]
        subprocess.run(command, cwd=ROOT, env=None if environment is None else {**os.environ, **environment}, check=True)
    if not expected.is_file():
        raise RuntimeError(f"build did not produce expected wheel: {expected}")
    verify_wheel(expected, args.package, wheel_version, None if args.platform is None else PLATFORMS[args.platform])
    print(expected)


# 中文说明：函数 repository_version 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def repository_version(root: Path = ROOT) -> str:
    # 中文说明：变量 package_json 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    package_json = root / "package.json"
    try:
        # 中文说明：变量 payload 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        payload = json.loads(package_json.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"could not read repository version from {package_json}") from error
    # 中文说明：变量 version 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    version = payload.get("version") if isinstance(payload, dict) else None
    if not isinstance(version, str) or re.fullmatch(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?", version) is None:
        raise ValueError(
            f"{package_json} version must be X.Y.Z with an optional prerelease segment, got {version!r}"
        )
    return version


# 中文说明：函数 pep440_version 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def pep440_version(version: str) -> str:
    """The Python spelling of a repository version.

    A release candidate is `0.0.1-rc.1` in the repository and `0.0.1rc1` under
    PEP 440. Build backends normalize to the latter, so the wheel filename and
    metadata carry it: comparing them against the repository spelling would
    reject every prerelease build.
    """
    stable, separator, prerelease = version.partition("-")
    if not separator:
        return stable
    # 中文说明：变量 match 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    match = re.fullmatch(r"(a|b|c|rc|alpha|beta|pre|preview)\.?(\d+)", prerelease)
    if match is None:
        raise ValueError(
            f"prerelease segment {prerelease!r} has no PEP 440 spelling; use rc.N, alpha.N, or beta.N"
        )
    # 中文说明：变量 identifier 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    identifier = {"alpha": "a", "beta": "b", "c": "rc", "pre": "rc", "preview": "rc"}.get(
        match.group(1), match.group(1)
    )
    return f"{stable}{identifier}{match.group(2)}"


# 中文说明：函数 validate_release_tag 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def validate_release_tag(tag: str | None, version: str) -> None:
    if tag is None:
        return
    # 中文说明：变量 expected 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    expected = f"python-v{version}"
    if tag != expected:
        raise ValueError(
            f"release tag must match repository version: expected {expected!r}, got {tag!r}"
        )


# 中文说明：函数 copy_package 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def copy_package(source: Path, destination: Path) -> None:
    shutil.copytree(
        source,
        destination,
        # 中文说明：变量 ignore 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        ignore=shutil.ignore_patterns(
            ".venv",
            ".pytest_cache",
            "__pycache__",
            "*.pyc",
            "dist",
            "node_modules",
            "dsh-jsonrpc-agent-pkg-*",
        ),
    )


# 中文说明：函数 rewrite_version 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def rewrite_version(pyproject: Path, version: str) -> None:
    text, count = re.subn(
        r'^version = "[^"]+"$',
        f'version = "{version}"',
        pyproject.read_text(),
        # 中文说明：变量 count 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        count=1,
        # 中文说明：变量 flags 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        flags=re.MULTILINE,
    )
    if count != 1:
        raise RuntimeError(f"could not rewrite version in {pyproject}")
    pyproject.write_text(text)


# 中文说明：函数 stage_license_files 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def stage_license_files(destination: Path, *, include_notices: bool) -> None:
    """Copy legal files and declare them as wheel license payloads."""
    shutil.copy2(ROOT / "LICENSE", destination / "LICENSE")
    # 中文说明：变量 license_files 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    license_files = '["LICENSE"]'
    if include_notices:
        shutil.copy2(ROOT / "THIRD_PARTY_NOTICES.md", destination / "THIRD_PARTY_NOTICES.md")
        # 中文说明：变量 license_files 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        license_files = '["LICENSE", "THIRD_PARTY_NOTICES.md"]'
    # 中文说明：变量 pyproject 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    pyproject = destination / "pyproject.toml"
    text, count = re.subn(
        r'^(license = "[^"]+")$',
        rf"\1\nlicense-files = {license_files}",
        pyproject.read_text(),
        # 中文说明：变量 count 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        count=1,
        # 中文说明：变量 flags 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        flags=re.MULTILINE,
    )
    if count != 1:
        raise RuntimeError(f"could not declare license files in {pyproject}")
    pyproject.write_text(text)


# 中文说明：函数 stage_sdk 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def stage_sdk(destination: Path, version: str) -> None:
    copy_package(ROOT / "python" / "sdk", destination)
    stage_license_files(destination, include_notices=False)
    # 中文说明：变量 pyproject 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    pyproject = destination / "pyproject.toml"
    rewrite_version(pyproject, version)
    text, count = re.subn(
        r'"deepseek-harness-runtime-bin==[^"]+"',
        f'"deepseek-harness-runtime-bin=={version}"',
        pyproject.read_text(),
        # 中文说明：变量 count 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        count=1,
    )
    if count != 1:
        raise RuntimeError("SDK must contain exactly one runtime dependency pin")
    pyproject.write_text(text)


# 中文说明：函数 stage_runtime 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def stage_runtime(destination: Path, version: str, executable: Path, executable_name: str) -> None:
    copy_package(ROOT / "python" / "sdk-runtime", destination)
    stage_license_files(destination, include_notices=True)
    rewrite_version(destination / "pyproject.toml", version)
    # 中文说明：变量 runtime_dir 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    runtime_dir = destination / "src" / "deepseek_harness_runtime" / "runtime"
    runtime_dir.mkdir(parents=True, exist_ok=True)
    # 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。
    for suffix in runtime_suffixes(executable_name):
        shutil.copy2(Path(f"{executable}{suffix}"), runtime_dir / f"{executable_name}{suffix}")


# 中文说明：函数 verify_wheel 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def verify_wheel(
    wheel: Path,
    package: str,
    version: str,
    platform: tuple[str, str] | None,
) -> None:
    # 中文说明：变量 expected_tag 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    expected_tag = "py3-none-any" if platform is None else f"py3-none-{platform[0]}"
    with zipfile.ZipFile(wheel) as archive:
        # 中文说明：变量 wheel_metadata_path 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        wheel_metadata_path = next(name for name in archive.namelist() if name.endswith(".dist-info/WHEEL"))
        # 中文说明：变量 metadata_path 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        metadata_path = next(name for name in archive.namelist() if name.endswith(".dist-info/METADATA"))
        # 中文说明：变量 wheel_metadata 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        wheel_metadata = email.message_from_bytes(archive.read(wheel_metadata_path))
        # 中文说明：变量 metadata 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        metadata = email.message_from_bytes(archive.read(metadata_path))
        if wheel_metadata.get_all("Tag") != [expected_tag]:
            raise RuntimeError(f"{wheel} has wrong WHEEL tags: {wheel_metadata.get_all('Tag')}")
        if metadata.get("Version") != version:
            raise RuntimeError(f"{wheel} has version {metadata.get('Version')}, expected {version}")
        # 中文说明：变量 expected_distribution 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        expected_distribution = SDK_DISTRIBUTION if package == "sdk" else RUNTIME_DISTRIBUTION
        if metadata.get("Name") != expected_distribution:
            raise RuntimeError(
                f"{wheel} has distribution name {metadata.get('Name')}, expected {expected_distribution}"
            )
        if metadata.get("License-Expression") != "MIT":
            raise RuntimeError(
                f"{wheel} has license expression {metadata.get('License-Expression')}, expected MIT"
            )
        # 中文说明：变量 expected_license_files 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        expected_license_files = ["LICENSE"] if package == "sdk" else ["LICENSE", "THIRD_PARTY_NOTICES.md"]
        # 中文说明：变量 license_files 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        license_files = [Path(name).name for name in metadata.get_all("License-File") or []]
        if license_files != expected_license_files:
            raise RuntimeError(
                f"{wheel} has license files {license_files}, expected {expected_license_files}"
            )
        # 中文说明：变量 runtime_files 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        runtime_files = [
            name for name in archive.namelist() if "/runtime/dsh-jsonrpc-agent-pkg-" in name
        ]
        if package == "runtime":
            assert platform is not None
            # 中文说明：变量 expected_files 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            expected_files = [f"{platform[1]}{suffix}" for suffix in runtime_suffixes(platform[1])]
            # 中文说明：变量 found_files 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            found_files = sorted(Path(name).name for name in runtime_files)
            if found_files != expected_files:
                raise RuntimeError(f"{wheel} runtime payload must be {expected_files}, found {found_files}")
            # 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。
            for runtime_file in runtime_files:
                # 中文说明：变量 mode 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
                mode = archive.getinfo(runtime_file).external_attr >> 16
                if mode & stat.S_IXUSR == 0:
                    raise RuntimeError(f"{wheel} runtime executable lost its executable bit: {runtime_file}")
        elif runtime_files:
            raise RuntimeError(f"SDK wheel unexpectedly contains runtime executables: {runtime_files}")
        if package == "sdk":
            # 中文说明：变量 requirements 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            requirements = metadata.get_all("Requires-Dist") or []
            # 中文说明：变量 expected_requirement 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            expected_requirement = f"{RUNTIME_DISTRIBUTION}=={version}"
            if expected_requirement not in requirements:
                raise RuntimeError(f"{wheel} does not pin {expected_requirement}; found {requirements}")


if __name__ == "__main__":
    main()
