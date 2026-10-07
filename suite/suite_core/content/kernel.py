"""Ask a product's Node kernel which row breaks a document, with the browsers' Yjs and the editor's schema.

Node is optional: without Node 24 or later, or without the product's built bundle, there is no
verdict and the caller keeps the document suspect. The child runs only from background jobs. It
reads rows on stdin and answers on stdout, with an empty environment, a heap limit and a timeout,
and it can't read files other than its bundle, write files or start processes.

The permission model doesn't cover the network: the child can still load Node's network modules.
The bundle has no network code on the judging path, names no Node module but node:crypto and
drops fetch and WebSocket before it reads its input, which test_kernel checks against the built
bundle. This guards against network use by mistake, not against a compromised child.

Bisecting peaks at about 30 times the input in resident memory, past the heap limit: about
120 MB at the 4 MiB state the scheduler aims for, and 560 MB for a 19.1 MB checkpoint, which
passed. Nothing bounds the input: a compaction job can meet a larger state. A child that runs out
of its 512 MB heap or is killed for memory fails as KernelFailed, and the document is held with
an alert.
"""

import base64
import json
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

import frappe

from suite.suite_core.content.selftest import node_version

NODE_MAJOR = 24
HEAP_MB = 512
TIMEOUT_S = 120
# A reason is a few words of the error, never document text, so it stops where quoted content could start
REASON_END = re.compile(r"[^A-Za-z0-9 _.:,-]")


@dataclass
class Verdict:
    # The first row that breaks the document, -1 for the checkpoint; None when every row is fine
    index: int | None
    reason: str = ""


class KernelFailed(Exception):
    """The child crashed, ran out of time or memory, or answered something unreadable."""


def judge(bundle: Path, checkpoint: bytes | None, rows: list[bytes]) -> Verdict | None:
    if not getattr(frappe.local, "job", None):
        raise RuntimeError("the collab kernel runs only in background jobs")
    node = usable_node()
    if not node or not bundle.is_file():
        return None
    # Node checks the read permission against the real path
    bundle = bundle.resolve()
    request = {
        "checkpoint": base64.b64encode(checkpoint).decode() if checkpoint else None,
        "rows": [base64.b64encode(row).decode() for row in rows],
    }
    try:
        done = subprocess.run(
            [
                node,
                "--permission",
                f"--allow-fs-read={bundle}",
                f"--max-old-space-size={HEAP_MB}",
                str(bundle),
            ],
            input=json.dumps(request),
            capture_output=True,
            text=True,
            timeout=TIMEOUT_S,
            env={},
            check=True,
        )
        answer = json.loads(done.stdout)
        if answer["verdict"] == "clean":
            return Verdict(None)
        index = answer["index"]
        if type(index) is not int or not -1 <= index < len(rows):
            raise ValueError("the index names no row")
        return Verdict(index, plain(str(answer["reason"])))
    except subprocess.CalledProcessError as error:
        last = error.stderr.strip().rsplit("\n", 1)[-1]
        raise KernelFailed(f"exit {error.returncode}: {plain(last)}") from error
    except (OSError, subprocess.SubprocessError, ValueError, KeyError, TypeError) as error:
        raise KernelFailed(repr(error)) from error


def plain(text: str) -> str:
    return REASON_END.split(text, maxsplit=1)[0][:80].strip()


def usable_node() -> str | None:
    version = node_version()
    if not version or int(version.lstrip("v").split(".")[0]) < NODE_MAJOR:
        return None
    return shutil.which("node")
