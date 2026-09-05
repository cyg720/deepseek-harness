"""Wire protocol vocabulary for the Python side of dsh-code-runtime-python.

Mirrors ``src/protocol.ts``. Frames travel on fd 3 as JSON-lines (one JSON
object per line). The host validates every inbound frame; this side trusts
host replies.

The wire uses the JSON key ``global`` (a Python keyword), so the frame
``TypedDict``s that carry it are declared with the functional syntax rather than
class bodies: a class attribute cannot be named ``global``, and a ``global_``
attribute would describe a key the wire never sends. Optional-field messages
pair a required base with a ``total=False`` subclass so a required field such as
``type`` cannot be dropped while ``value``/``error``/``truncated`` stay optional.
"""
# 文件职责：声明 Python 代码运行子进程与 Node 宿主之间的 JSON Lines 协议类型和日志截断标记。
# 技术维度：使用 TypedDict、Literal、Union 和文件描述符 3 上的逐行 JSON 通信。
# 产品维度：让受限 Python 程序能够调用宿主命名空间并把日志、结果或错误安全返回。
# 逻辑维度：依次定义启动、运行、调用、回复、日志和完成消息，再组合双向联合类型。
# 关键边界：本文件必须与 TypeScript 协议镜像保持字段级一致；global 关键字需使用函数式 TypedDict。
# 新手阅读建议：先看 PROTOCOL_FD，再按 HostToChild 和 ChildToHost 两个方向阅读消息类型。

from __future__ import annotations

from typing import Any, Literal, TypedDict, Union

# The protocol fd from the child's perspective. Node passes
# ``stdio: [pipe, pipe, pipe, pipe]`` so the fourth entry (fd 3) is the
# framed-JSON channel; stdout/stderr stay clear for the program's own output.
# 中文说明：协议固定使用子进程文件描述符 3，标准输出和错误仍留给用户程序。
PROTOCOL_FD = 3


class ErrorClass(TypedDict):
    """A namespace's program-visible exception class: rejected calls raise its
    instances carrying the failed member name on ``memberNameProperty``."""
    # 中文说明：描述宿主拒绝调用时在程序中创建的异常类及成员名字段。

    # 中文说明：异常类名称，必须是宿主声明的字符串。
    name: str
    # 中文说明：异常实例上保存失败成员名的属性名称。
    memberNameProperty: str


# ``global`` is a Python keyword, so the required part is declared functionally
# to hold the real wire key; ``errorClass`` is optional per the TS `errorClass?`.
# 中文说明：命名空间必填字段；函数式写法允许保留 JSON 中的 global 键。
_NamespaceRequired = TypedDict("_NamespaceRequired", {"global": str, "names": "list[str]"})


class Namespace(_NamespaceRequired, total=False):
    """One binding namespace declaration: the ``global`` name, its function
    ``names``, and an optional program-visible ``errorClass`` for rejected calls."""
    # 中文说明：声明一组可调用宿主函数及可选的程序可见错误类型。

    # 中文说明：可选错误类描述；省略时拒绝调用使用运行时默认错误。
    errorClass: ErrorClass


class BootMessage(TypedDict):
    """Host → child, first frame on fd 3. Carries every cap and the namespaces."""
    # 中文说明：宿主发给子进程的首帧，包含资源上限和可调用命名空间。

    # 中文说明：协议字段 type，取值类型为 Literal["boot"]，仅按对应消息方向传输。
    type: Literal["boot"]
    # 中文说明：协议字段 cpuSeconds，取值类型为 int，仅按对应消息方向传输。
    cpuSeconds: int
    # 中文说明：协议字段 addressSpaceBytes，取值类型为 int，仅按对应消息方向传输。
    addressSpaceBytes: int
    # 中文说明：协议字段 maxLogBytes，取值类型为 int，仅按对应消息方向传输。
    maxLogBytes: int
    # 中文说明：协议字段 maxValueBytes，取值类型为 int，仅按对应消息方向传输。
    maxValueBytes: int
    # 中文说明：协议字段 namespaces，取值类型为 "list[Namespace]"，仅按对应消息方向传输。
    namespaces: "list[Namespace]"


class RunMessage(TypedDict):
    """Host → child, sent after ``boot-ack``. Carries only the program body."""
    # 中文说明：子进程确认启动后接收的程序正文消息。

    # 中文说明：协议字段 type，取值类型为 Literal["run"]，仅按对应消息方向传输。
    type: Literal["run"]
    # 中文说明：协议字段 program，取值类型为 str，仅按对应消息方向传输。
    program: str


class BootAckMessage(TypedDict):
    """Child → host: resource limits applied, ready for the run message."""
    # 中文说明：子进程确认资源限制已应用，可以接收运行消息。

    # 中文说明：协议字段 type，取值类型为 Literal["boot-ack"]，仅按对应消息方向传输。
    type: Literal["boot-ack"]


# ``global`` wire key: whole message declared functionally, all fields required.
# 中文说明：子进程调用宿主函数的消息；所有字段必填，并保留 global 原始键名。
CallMessage = TypedDict(
    "CallMessage",
    {"type": Literal["call"], "id": int, "global": str, "name": str, "args": Any},
)


# 中文说明：日志消息的必填字段，包含标签和文本分块。
_LogMessageRequired = TypedDict("_LogMessageRequired", {"type": Literal["log"], "text": str})


class LogMessage(_LogMessageRequired, total=False):
    """Child → host: one captured text chunk, streamed eagerly.

    ``truncated`` is set only on the frame that IS the child ledger's truncation
    marker (not program output), so the host stops capturing at the same point
    the child did — mirrors the TS `truncated?`. ``open`` is set on a flushed unterminated line the host appends the next frame to (mirrors `open?`).
    """
    # 中文说明：子进程流式发送的日志分块；仅截断标记帧设置 truncated。

    # 中文说明：协议字段 truncated，取值类型为 bool，仅按对应消息方向传输。
    truncated: bool
    open: bool


class DoneErrorField(TypedDict):
    """Child → host: the failure carried on a ``done`` frame. ``kind`` is one of
    the three the host validates; ``message`` is the traceback or diagnostic."""
    # 中文说明：完成帧中的结构化失败，区分程序异常、无效输出和输出超限。

    # 中文说明：协议字段 kind，取值类型为 Literal["exception", "invalid-output", "output-limit"]，仅按对应消息方向传输。
    kind: Literal["exception", "invalid-output", "output-limit"]
    # 中文说明：协议字段 message，取值类型为 str，仅按对应消息方向传输。
    message: str


# 中文说明：完成消息必填部分，只包含固定类型标签。
_DoneMessageRequired = TypedDict("_DoneMessageRequired", {"type": Literal["done"]})


class DoneMessage(_DoneMessageRequired, total=False):
    """Child → host: the program settled. ``value`` and ``error`` are optional per the TS mirror."""
    # 中文说明：程序结束消息，可携带成功值或结构化错误。

    # 中文说明：协议字段 value，取值类型为 Any，仅按对应消息方向传输。
    value: Any
    # 中文说明：协议字段 error，取值类型为 DoneErrorField，仅按对应消息方向传输。
    error: DoneErrorField


# 中文说明：子进程允许发送给宿主的全部消息联合类型。
ChildToHost = Union[BootAckMessage, CallMessage, LogMessage, DoneMessage]


class ReplyOk(TypedDict):
    # 中文说明：宿主调用成功回复，携带与请求一致的编号和值。
    type: Literal["reply"]
    # 中文说明：协议字段 id，取值类型为 int，仅按对应消息方向传输。
    id: int
    # 中文说明：协议字段 ok，取值类型为 Literal[True]，仅按对应消息方向传输。
    ok: Literal[True]
    # 中文说明：协议字段 value，取值类型为 Any，仅按对应消息方向传输。
    value: Any


class ReplyErr(TypedDict):
    # 中文说明：宿主调用失败回复，携带请求编号和可显示错误文本。
    type: Literal["reply"]
    # 中文说明：协议字段 id，取值类型为 int，仅按对应消息方向传输。
    id: int
    # 中文说明：协议字段 ok，取值类型为 Literal[False]，仅按对应消息方向传输。
    ok: Literal[False]
    # 中文说明：协议字段 message，取值类型为 str，仅按对应消息方向传输。
    message: str


# 中文说明：宿主调用回复的成功或失败联合类型。
ReplyMessage = Union[ReplyOk, ReplyErr]
# The host sends ``boot`` and ``run`` before any ``reply``, so the child-facing
# inbound union covers all three, not replies alone.
# 中文说明：子进程可能接收启动、运行或调用回复三类宿主消息。
HostToChild = Union[BootMessage, RunMessage, ReplyMessage]


def log_truncation_marker(max_bytes: int) -> str:
    """Return the in-band marker for a log ledger that exhausted its budget.

    Byte-identical text on both sides of the wire so a truncated run reads the
    same however the cap was hit.
    """
    # 中文说明：根据日志字节上限生成两端完全一致的截断提示；参数为最大字节数，返回提示字符串；例如 log_truncation_marker(1024)。

    return f"[dsh-code-runtime-python] log capture truncated at {max_bytes} bytes"
