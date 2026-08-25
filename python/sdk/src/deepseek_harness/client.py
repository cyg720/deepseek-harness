# 文件职责：实现 client.py 覆盖的Python SDK 与捆绑运行时职责。
# 技术维度：使用 Python、异步 I/O、JSON-RPC、构建后端或标准库文件与进程接口。
# 产品维度：保障 Agent 的Python SDK 与捆绑运行时能力可安装、可调用且可诊断。
# 逻辑维度：解析参数或数据，执行核心调用或校验，再返回结果并处理资源清理。
# 关键边界：外部进程与文件不可信；版本和平台条件必须显式；敏感环境变量不得泄露。
# 新手阅读建议：先看导入和公开类型，再读主流程，最后关注异常、平台差异和清理。
from __future__ import annotations

import json
import os
import queue
import subprocess
import threading
import time
import uuid
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, TypeAlias, TypeVar

from pydantic import BaseModel

from .errors import JsonRpcError, TransportClosedError
from .models import IncomingRequest, InitializeResponse, JsonObject, JsonValue, Notification

# 中文说明：变量 ModelT 保存本模块共享的固定值；取值由紧邻初始化或后续赋值决定。
ModelT = TypeVar("ModelT", bound=BaseModel)
# 中文说明：变量 NotificationFilter 保存本模块共享的固定值；取值由紧邻初始化或后续赋值决定。
NotificationFilter: TypeAlias = Callable[[Notification], bool]


@dataclass(slots=True)
# 中文说明：类 HarnessConfig 封装本模块所需的数据和行为，用于表达Python SDK 与捆绑运行时场景。
class HarnessConfig:
    """Configuration for launching the local DeepSeek Harness SDK runtime."""

    # 中文说明：变量 runtime_bin 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    runtime_bin: str | None = None
    # 中文说明：变量 bridge_bin 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    bridge_bin: str | None = None
    # 中文说明：变量 launch_args_override 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    launch_args_override: tuple[str, ...] | None = None
    # 中文说明：变量 cwd 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    cwd: str | None = None
    # 中文说明：变量 env 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    env: dict[str, str] | None = None
    # 中文说明：变量 request_timeout_seconds 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    request_timeout_seconds: float | None = None
    # 中文说明：变量 shutdown_timeout_seconds 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    shutdown_timeout_seconds: float | None = 1.0


# 中文说明：类 HarnessClient 封装本模块所需的数据和行为，用于表达Python SDK 与捆绑运行时场景。
class HarnessClient:
    """Synchronous JSON-RPC client for the DeepSeek Harness SDK runtime over stdio."""

    # 中文说明：函数 __init__ 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def __init__(self, config: HarnessConfig | None = None) -> None:
        self.config = config or HarnessConfig()
        self._proc: subprocess.Popen[str] | None = None
        self._lock = threading.Lock()
        self._write_lock = threading.Lock()
        self._responses: dict[str, queue.Queue[JsonValue | BaseException]] = {}
        self._notifications: queue.Queue[Notification | BaseException] = queue.Queue()
        self._notification_subscribers: dict[
            str, tuple[queue.Queue[Notification | BaseException], NotificationFilter | None]
        ] = {}
        self._session_parents: dict[str, str] = {}
        self._requests: queue.Queue[IncomingRequest | BaseException] = queue.Queue()
        self._stderr_lines: deque[str] = deque(maxlen=400)
        self._reader_thread: threading.Thread | None = None
        self._stderr_thread: threading.Thread | None = None

    # 中文说明：函数 __enter__ 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def __enter__(self) -> "HarnessClient":
        self.start()
        return self

    # 中文说明：函数 __exit__ 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def __exit__(self, _exc_type, _exc, _tb) -> None:
        self.close()

    # 中文说明：函数 start 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def start(self) -> None:
        if self._proc is not None:
            return
        with self._lock:
            self._session_parents.clear()
        # 中文说明：变量 args 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        args = list(self.config.launch_args_override or self._default_launch_args())
        # 中文说明：变量 env 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        env = os.environ.copy()
        if self.config.env:
            env.update(self.config.env)
        self._inject_bundled_default_config(env)
        self._proc = subprocess.Popen(
            args,
            # 中文说明：变量 stdin 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            stdin=subprocess.PIPE,
            # 中文说明：变量 stdout 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            stdout=subprocess.PIPE,
            # 中文说明：变量 stderr 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            stderr=subprocess.PIPE,
            # 中文说明：变量 text 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            text=True,
            # 中文说明：变量 encoding 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            encoding="utf-8",
            # 中文说明：变量 cwd 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            cwd=None if self.config.cwd is None else str(Path(self.config.cwd).resolve()),
            # 中文说明：变量 env 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            env=env,
            # 中文说明：变量 bufsize 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            bufsize=1,
        )
        self._start_reader_thread()
        self._start_stderr_thread()

    # 中文说明：函数 close 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def close(self) -> None:
        # 中文说明：变量 proc 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        proc = self._proc
        if proc is None:
            return
        try:
            self.request("shutdown", None, response_model=_ShutdownResponse, timeout_seconds=self.config.shutdown_timeout_seconds)
        except Exception as exc:
            self._stderr_lines.append(f"shutdown request failed: {exc}")
        if proc.stdin:
            try:
                proc.stdin.close()
            except Exception as exc:
                self._stderr_lines.append(f"stdin close failed: {exc}")
        if proc.poll() is None:
            try:
                proc.terminate()
            except ProcessLookupError:
                pass
        try:
            proc.wait(timeout=self.config.shutdown_timeout_seconds)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
        self._proc = None
        self._fail_waiters(self._runtime_closed_error("DeepSeek Harness runtime closed"))
        if self._reader_thread and self._reader_thread.is_alive():
            self._reader_thread.join(timeout=0.5)
        if self._stderr_thread and self._stderr_thread.is_alive():
            self._stderr_thread.join(timeout=0.5)

    # 中文说明：函数 initialize 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def initialize(
        self,
        *,
        cwd: str,
        provider: str,
        model: str,
        # 中文说明：变量 max_tokens 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        max_tokens: int | None = None,
    ) -> InitializeResponse:
        # 中文说明：变量 payload 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        payload: JsonObject = {
            "cwd": str(Path(cwd).resolve()),
            "provider": provider,
            "model": model,
        }
        if max_tokens is not None:
            payload["maxTokens"] = max_tokens
        try:
            return self.request("initialize", payload, response_model=InitializeResponse)
        except BaseException:
            self.close()
            raise

    # 中文说明：函数 session_prompt 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def session_prompt(
        self,
        session_id: str,
        content_blocks: list[JsonObject],
        *,
        # 中文说明：变量 on_notification 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        on_notification: Callable[[Notification], None] | None = None,
        # 中文说明：变量 notification_subscription 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        notification_subscription: "NotificationSubscription | None" = None,
    ) -> str:
        # 中文说明：变量 payload 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        payload: JsonObject = {"sessionId": session_id, "contentBlocks": content_blocks}
        # 中文说明：变量 response 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        response = self.request(
            "session/prompt",
            payload,
            # 中文说明：变量 response_model 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            response_model=_SessionPromptResponse,
            # 中文说明：变量 on_notification 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            on_notification=on_notification,
            # 中文说明：变量 notification_filter 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            notification_filter=self._notification_belongs_to_session_tree(session_id),
            # 中文说明：变量 notification_subscription 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            notification_subscription=notification_subscription,
        )
        return response.messageId

    # 中文说明：函数 request 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def request(
        self,
        method: str,
        params: JsonObject | None,
        *,
        response_model: type[ModelT],
        # 中文说明：变量 timeout_seconds 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        timeout_seconds: float | None = None,
        # 中文说明：变量 on_notification 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        on_notification: Callable[[Notification], None] | None = None,
        # 中文说明：变量 notification_filter 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        notification_filter: NotificationFilter | None = None,
        # 中文说明：变量 notification_subscription 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        notification_subscription: "NotificationSubscription | None" = None,
    ) -> ModelT:
        # 中文说明：变量 result 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        result = self._request_raw(
            method,
            params,
            # 中文说明：变量 timeout_seconds 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            timeout_seconds=timeout_seconds,
            # 中文说明：变量 on_notification 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            on_notification=on_notification,
            # 中文说明：变量 notification_filter 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            notification_filter=notification_filter,
            # 中文说明：变量 notification_subscription 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            notification_subscription=notification_subscription,
        )
        if not isinstance(result, dict):
            raise TypeError(f"{method} response must be a JSON object")
        return response_model.model_validate(result)

    # 中文说明：函数 notify 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def notify(self, method: str, params: JsonObject | None = None) -> None:
        # 中文说明：变量 message 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        message: JsonObject = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            message["params"] = params
        self._write_message(message)

    # 中文说明：函数 next_notification 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def next_notification(self) -> Notification:
        # 中文说明：变量 item 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        item = self._notifications.get()
        if isinstance(item, BaseException):
            raise item
        return item

    # 中文说明：函数 subscribe_notifications 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def subscribe_notifications(
        self,
        # 中文说明：变量 notification_filter 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        notification_filter: NotificationFilter | None = None,
    ) -> "NotificationSubscription":
        # 中文说明：变量 subscription_id 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        subscription_id = str(uuid.uuid4())
        # 中文说明：变量 notifications 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        notifications: queue.Queue[Notification | BaseException] = queue.Queue()
        with self._lock:
            self._notification_subscribers[subscription_id] = (notifications, notification_filter)
        return NotificationSubscription(self, subscription_id, notifications)

    # 中文说明：函数 subscribe_session_notifications 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def subscribe_session_notifications(self, session_id: str) -> "NotificationSubscription":
        """Subscribe to a session and descendants discovered from subagent lifecycle edges."""
        return self.subscribe_notifications(self._notification_belongs_to_session_tree(session_id))

    # 中文说明：函数 next_request 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def next_request(self) -> IncomingRequest:
        # 中文说明：变量 item 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        item = self._requests.get()
        if isinstance(item, BaseException):
            raise item
        return item

    # 中文说明：函数 respond 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def respond(self, request_id: str | int, result: JsonValue) -> None:
        self._write_message({"jsonrpc": "2.0", "id": request_id, "result": result})

    # 中文说明：函数 respond_error 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def respond_error(
        self,
        request_id: str | int,
        *,
        code: int,
        message: str,
        # 中文说明：变量 data 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        data: JsonValue | None = None,
    ) -> None:
        # 中文说明：变量 error 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        error: JsonObject = {"code": code, "message": message}
        if data is not None:
            error["data"] = data
        self._write_message({"jsonrpc": "2.0", "id": request_id, "error": error})

    # 中文说明：函数 _request_raw 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def _request_raw(
        self,
        method: str,
        # 中文说明：变量 params 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        params: JsonObject | None = None,
        *,
        # 中文说明：变量 timeout_seconds 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        timeout_seconds: float | None = None,
        # 中文说明：变量 on_notification 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        on_notification: Callable[[Notification], None] | None = None,
        # 中文说明：变量 notification_filter 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        notification_filter: NotificationFilter | None = None,
        # 中文说明：变量 notification_subscription 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        notification_subscription: "NotificationSubscription | None" = None,
    ) -> JsonValue:
        # 中文说明：变量 request_id 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        request_id = str(uuid.uuid4())
        # 中文说明：变量 waiter 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        waiter: queue.Queue[JsonValue | BaseException] = queue.Queue(maxsize=1)
        # 中文说明：变量 temp_subscription 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        temp_subscription: NotificationSubscription | None = None
        # 中文说明：变量 subscription 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        subscription = notification_subscription
        with self._lock:
            self._responses[request_id] = waiter
        if on_notification is not None and subscription is None:
            # 中文说明：变量 temp_subscription 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            temp_subscription = self.subscribe_notifications(notification_filter)
            # 中文说明：变量 subscription 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            subscription = temp_subscription
        try:
            # 中文说明：变量 message 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            message: JsonObject = {"jsonrpc": "2.0", "id": request_id, "method": method}
            if params is not None:
                message["params"] = params
            self._write_message(message)
        except BaseException:
            with self._lock:
                self._responses.pop(request_id, None)
            if temp_subscription is not None:
                temp_subscription.close()
            raise
        # 中文说明：变量 timeout 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        timeout = self.config.request_timeout_seconds if timeout_seconds is None else timeout_seconds
        # 中文说明：变量 deadline 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        deadline = None if timeout is None else time.monotonic() + timeout
        try:
            while True:
                if on_notification is not None and subscription is not None:
                    subscription.drain(on_notification)
                # 中文说明：变量 wait_timeout 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
                wait_timeout = None
                if on_notification is not None:
                    # 中文说明：变量 wait_timeout 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
                    wait_timeout = 0.05
                if deadline is not None:
                    # 中文说明：变量 remaining 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        with self._lock:
                            self._responses.pop(request_id, None)
                        # 中文说明：变量 diagnostics 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
                        diagnostics = self._runtime_diagnostics()
                        # 中文说明：变量 suffix 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
                        suffix = f"\n{diagnostics}" if diagnostics else ""
                        raise TimeoutError(
                            f"{method} timed out waiting for DeepSeek Harness runtime{suffix}"
                        )
                    # 中文说明：变量 wait_timeout 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
                    wait_timeout = remaining if wait_timeout is None else min(wait_timeout, remaining)
                try:
                    # 中文说明：变量 item 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
                    item = waiter.get(timeout=wait_timeout)
                    if on_notification is not None and subscription is not None:
                        subscription.drain(on_notification)
                    break
                except queue.Empty:
                    continue
        except BaseException:
            with self._lock:
                self._responses.pop(request_id, None)
            if temp_subscription is not None:
                temp_subscription.close()
            raise
        finally:
            if temp_subscription is not None:
                temp_subscription.close()
        if isinstance(item, BaseException):
            raise item
        return item

    # 中文说明：函数 _write_message 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def _write_message(self, message: JsonObject) -> None:
        # 中文说明：变量 proc 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        proc = self._proc
        if proc is None or proc.stdin is None:
            raise TransportClosedError("DeepSeek Harness runtime is not running")
        try:
            # 中文说明：变量 payload 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            payload = json.dumps(message, separators=(",", ":")) + "\n"
            with self._write_lock:
                proc.stdin.write(payload)
                proc.stdin.flush()
        except Exception as exc:
            raise self._runtime_closed_error("Failed to write to DeepSeek Harness runtime") from exc

    # 中文说明：函数 _start_reader_thread 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def _start_reader_thread(self) -> None:
        self._reader_thread = threading.Thread(target=self._reader_loop, name="dsh-runtime-reader", daemon=True)
        self._reader_thread.start()

    # 中文说明：函数 _start_stderr_thread 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def _start_stderr_thread(self) -> None:
        self._stderr_thread = threading.Thread(target=self._stderr_loop, name="dsh-runtime-stderr", daemon=True)
        self._stderr_thread.start()

    # 中文说明：函数 _reader_loop 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def _reader_loop(self) -> None:
        # 中文说明：变量 proc 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        proc = self._proc
        if proc is None or proc.stdout is None:
            return
        try:
            # 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。
            for line in proc.stdout:
                if not line.strip():
                    continue
                try:
                    # 中文说明：变量 message 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
                    message = json.loads(line)
                except json.JSONDecodeError:
                    continue
                self._handle_message(message)
        except BaseException as exc:
            self._fail_waiters(exc)
        finally:
            self._fail_waiters(self._runtime_closed_error("DeepSeek Harness runtime stdout closed"))

    # 中文说明：函数 _stderr_loop 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def _stderr_loop(self) -> None:
        # 中文说明：变量 proc 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        proc = self._proc
        if proc is None or proc.stderr is None:
            return
        # 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。
        for line in proc.stderr:
            self._stderr_lines.append(line.rstrip())

    # 中文说明：函数 _handle_message 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def _handle_message(self, message: object) -> None:
        if not isinstance(message, dict):
            return
        # 中文说明：变量 msg_id 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        msg_id = message.get("id")
        # 中文说明：变量 method 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        method = message.get("method")
        if isinstance(msg_id, (str, int)) and isinstance(method, str):
            # 中文说明：变量 params 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            params = message.get("params")
            self._requests.put(IncomingRequest(id=msg_id, method=method, payload=params if isinstance(params, dict) else {}))
            return
        if isinstance(msg_id, (str, int)):
            with self._lock:
                # 中文说明：变量 waiter 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
                waiter = self._responses.pop(str(msg_id), None)
            if waiter is None:
                return
            if isinstance(message.get("error"), dict):
                # 中文说明：变量 err 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
                err = message["error"]
                waiter.put(JsonRpcError(_int_or_none(err.get("code")), str(err.get("message", "JSON-RPC error")), err.get("data")))
            else:
                waiter.put(message.get("result"))
            return
        if isinstance(method, str):
            # 中文说明：变量 params 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            params = message.get("params")
            # 中文说明：变量 notification 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            notification = Notification(method=method, payload=params if isinstance(params, dict) else {})
            with self._lock:
                self._record_session_relationship_locked(notification)
                # 中文说明：变量 subscribers 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
                subscribers = list(self._notification_subscribers.items())
            # 中文说明：变量 delivered 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            delivered = False
            # 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。
            for subscription_id, (subscriber, predicate) in subscribers:
                try:
                    # 中文说明：变量 matches 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
                    matches = predicate is None or predicate(notification)
                except BaseException as exc:
                    with self._lock:
                        # 中文说明：变量 current 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
                        current = self._notification_subscribers.get(subscription_id)
                        if current is not None and current[0] is subscriber:
                            self._notification_subscribers.pop(subscription_id, None)
                    subscriber.put(exc)
                    continue
                if matches:
                    subscriber.put(notification)
                    # 中文说明：变量 delivered 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
                    delivered = True
            if not delivered:
                self._notifications.put(notification)

    # 中文说明：函数 _fail_waiters 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def _fail_waiters(self, exc: BaseException) -> None:
        with self._lock:
            # 中文说明：变量 waiters 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            waiters = list(self._responses.values())
            self._responses.clear()
            # 中文说明：变量 subscribers 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            subscribers = list(self._notification_subscribers.values())
            self._notification_subscribers.clear()
        # 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。
        for waiter in waiters:
            waiter.put(exc)
        # 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。
        for subscriber, _predicate in subscribers:
            subscriber.put(exc)
        self._notifications.put(exc)
        self._requests.put(exc)

    # 中文说明：函数 _runtime_closed_error 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def _runtime_closed_error(self, reason: str) -> TransportClosedError:
        # 中文说明：变量 diagnostics 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        diagnostics = self._runtime_diagnostics()
        return TransportClosedError(f"{reason}\n{diagnostics}" if diagnostics else reason)

    # 中文说明：函数 _runtime_diagnostics 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def _runtime_diagnostics(self) -> str:
        """Return available subprocess state for transport failures and timeouts."""
        # 中文说明：变量 proc 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        proc = self._proc
        if (
            proc is not None
            and proc.poll() is not None
            and self._stderr_thread is not None
            and self._stderr_thread.is_alive()
            and threading.current_thread() is not self._stderr_thread
        ):
            self._stderr_thread.join(timeout=0.1)

        # 中文说明：变量 parts 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        parts: list[str] = []
        if proc is not None:
            # 中文说明：变量 exit_code 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            exit_code = proc.poll()
            if exit_code is not None:
                parts.append(f"exit code: {exit_code}")
        if self._stderr_lines:
            parts.append("stderr tail:\n" + "\n".join(self._stderr_lines))
        return "\n".join(parts)

    # 中文说明：函数 _default_launch_args 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def _default_launch_args(self) -> tuple[str, ...]:
        if self.config.runtime_bin is not None:
            return (self.config.runtime_bin,)
        if self.config.bridge_bin is not None:
            return (self.config.bridge_bin,)
        try:
            from deepseek_harness_runtime import resolve_bundled_launch_args
        except ImportError as exc:
            raise FileNotFoundError(
                "Unable to locate the bundled DeepSeek Harness SDK runtime. "
                "Install deepseek-harness-runtime-bin or set HarnessConfig.runtime_bin."
            ) from exc
        return resolve_bundled_launch_args()

    # 中文说明：函数 _inject_bundled_default_config 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def _inject_bundled_default_config(self, env: dict[str, str]) -> None:
        """Inject the default config for a bundled launch with no non-empty config.

        Both bundled carriers require an explicit config. Explicit runtime,
        launch-argument, and config channels remain untouched.
        """
        # 中文说明：变量 uses_bundled_runtime 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        uses_bundled_runtime = (
            self.config.launch_args_override is None
            and self.config.runtime_bin is None
            and self.config.bridge_bin is None
        )
        if not uses_bundled_runtime or env.get("DSH_CORDIS_CONFIG"):
            return
        # _default_launch_args already imported the package or raised its install error.
        from deepseek_harness_runtime import bundled_default_config_path

        env["DSH_CORDIS_CONFIG"] = str(bundled_default_config_path())

    # 中文说明：函数 _unsubscribe_notifications 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def _unsubscribe_notifications(self, subscription_id: str) -> None:
        with self._lock:
            self._notification_subscribers.pop(subscription_id, None)

    # 中文说明：函数 _record_session_relationship_locked 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def _record_session_relationship_locked(self, notification: Notification) -> None:
        if notification.method != "subagent.started":
            return
        # 中文说明：变量 parent_id 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        parent_id = notification.payload.get("parentSessionId")
        # 中文说明：变量 child_id 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        child_id = notification.payload.get("childSessionId")
        if (
            isinstance(parent_id, str)
            and parent_id
            and isinstance(child_id, str)
            and child_id
            and parent_id != child_id
        ):
            self._session_parents[child_id] = parent_id

    # 中文说明：函数 _notification_belongs_to_session_tree 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def _notification_belongs_to_session_tree(self, session_id: str) -> NotificationFilter:
        # 中文说明：函数 belongs 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
        def belongs(notification: Notification) -> bool:
            # 中文说明：变量 payload 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            payload = notification.payload
            if notification.method in {"subagent.started", "subagent.finished"}:
                # 中文说明：变量 parent_id 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
                parent_id = payload.get("parentSessionId")
                if (
                    isinstance(parent_id, str)
                    and self._session_is_descendant_of(parent_id, session_id)
                ):
                    return True
                return payload.get("childSessionId") == session_id
            # 中文说明：变量 related_id 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            related_id = payload.get("sessionId")
            return (
                isinstance(related_id, str)
                and self._session_is_descendant_of(related_id, session_id)
            )

        return belongs

    # 中文说明：函数 _session_is_descendant_of 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def _session_is_descendant_of(self, session_id: str, root_session_id: str) -> bool:
        # 中文说明：变量 current 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        current = session_id
        # 中文说明：变量 visited 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        visited: set[str] = set()
        while current not in visited:
            if current == root_session_id:
                return True
            visited.add(current)
            # 中文说明：变量 parent 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            parent = self._session_parents.get(current)
            if parent is None:
                return False
            # 中文说明：变量 current 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            current = parent
        return False


# 中文说明：类 NotificationSubscription 封装本模块所需的数据和行为，用于表达Python SDK 与捆绑运行时场景。
class NotificationSubscription:
    # 中文说明：函数 __init__ 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def __init__(
        self,
        client: HarnessClient,
        subscription_id: str,
        notifications: queue.Queue[Notification | BaseException],
    ) -> None:
        self._client = client
        self._subscription_id = subscription_id
        self._notifications = notifications
        self._closed = False

    # 中文说明：函数 __enter__ 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def __enter__(self) -> "NotificationSubscription":
        return self

    # 中文说明：函数 __exit__ 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def __exit__(self, _exc_type, _exc, _tb) -> None:
        self.close()

    # 中文说明：函数 close 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._client._unsubscribe_notifications(self._subscription_id)

    # 中文说明：函数 next 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def next(self) -> Notification:
        # 中文说明：变量 item 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        item = self._notifications.get()
        if isinstance(item, BaseException):
            raise item
        return item

    # 中文说明：函数 drain 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def drain(self, on_notification: Callable[[Notification], None]) -> None:
        while True:
            try:
                # 中文说明：变量 item 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
                item = self._notifications.get_nowait()
            except queue.Empty:
                return
            if isinstance(item, BaseException):
                raise item
            on_notification(item)


# 中文说明：类 _SessionPromptResponse 封装本模块所需的数据和行为，用于表达Python SDK 与捆绑运行时场景。
class _SessionPromptResponse(BaseModel):
    messageId: str


# 中文说明：类 _ShutdownResponse 封装本模块所需的数据和行为，用于表达Python SDK 与捆绑运行时场景。
class _ShutdownResponse(BaseModel):
    pass


# 中文说明：函数 _int_or_none 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def _int_or_none(value: object) -> int | None:
    return value if isinstance(value, int) else None
