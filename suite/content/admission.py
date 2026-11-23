"""What limits compactions: how many run at once on a bench, how long one may take, and the memory it may use."""

import os
import resource
import secrets

import frappe
from frappe.utils.background_jobs import get_redis_conn
from rq import get_current_job

TIMEOUT = 120
PLACES = 2
PER_COMPACTION = 240 * 2**20
LEASE_SECONDS = TIMEOUT + 90
CGROUP = "/sys/fs/cgroup"
KEY_PREFIX = "suite:collab:"

# Bench-wide places, held in RQ's Redis; a lease outlives the job timeout, so a killed horse frees its place
RELEASE_SCRIPT = (
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0"
)


def take_place(app: str, doc_id: str) -> tuple[str, list[str]] | None:
    """Take one of `PLACES` and the document's own key, under a token a job past its lease can't free."""
    redis = get_redis_conn()
    token = secrets.token_hex(16)
    doc_key = f"{KEY_PREFIX}compacting:{frappe.local.site}:{app}:{doc_id}"
    if not redis.set(doc_key, token, nx=True, ex=LEASE_SECONDS):
        return None

    for index in range(PLACES):
        key = f"{KEY_PREFIX}compaction:{index}"
        if redis.set(key, token, nx=True, ex=LEASE_SECONDS):
            return token, [key, doc_key]

    redis.eval(RELEASE_SCRIPT, 1, doc_key, token)
    return None


def free_place(place: tuple[str, list[str]]) -> None:
    """Free the place and the document key where this job's token still holds them."""
    token, keys = place
    redis = get_redis_conn()
    for key in keys:
        redis.eval(RELEASE_SCRIPT, 1, key, token)


def enough_memory() -> bool:
    """With every place compacting, 20% of the container must stay free. True where the cgroup can't be read."""
    try:
        with open(f"{CGROUP}/memory.max") as limit_file:
            max_text = limit_file.read().strip()

        with open(f"{CGROUP}/memory.stat") as stat_file:
            anon_line = next(line for line in stat_file if line.startswith("anon "))

        _, anon_text = anon_line.split()
        anon_bytes = int(anon_text)
    except (OSError, StopIteration, ValueError):
        return True

    if max_text == "max":
        return True

    limit = int(max_text)
    return limit - anon_bytes - PLACES * PER_COMPACTION >= limit // 5


def forked_for_job() -> bool:
    """Whether this process is a horse RQ forked for the job it runs."""
    # RQ sets RQ_JOB_ID only after forking a horse; a no-fork worker, threaded or not, runs in the site process
    job = get_current_job()
    return job is not None and os.environ.get("RQ_JOB_ID") == job.id


def limit_memory() -> None:
    """Cap this work horse's address space, on Linux and only in a horse RQ forked for this job."""
    if not forked_for_job():
        return

    try:
        with open("/proc/self/status") as status:
            size_line = next(line for line in status if line.startswith("VmSize:"))

        _, size_kb, *_ = size_line.split()
        address_space = int(size_kb) * 1024
        resource.setrlimit(resource.RLIMIT_AS, (address_space + PER_COMPACTION, resource.RLIM_INFINITY))
    except (OSError, StopIteration, ValueError):
        pass
