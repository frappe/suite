"""What limits compactions: how many run at once on a bench, how long one may take, and the memory it may use."""

import os
import resource
import secrets

import frappe
from frappe.utils import sbool
from frappe.utils.background_jobs import get_redis_conn

TIMEOUT = 120
PLACES = 2
PER_COMPACTION = 240 * 2**20
LEASE = TIMEOUT + 90
CGROUP = "/sys/fs/cgroup"

# Bench-wide places, held in RQ's Redis; a lease outlives the job timeout, so a killed horse frees its place
RELEASE = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0"


def take_place(adapter: str, doc_id: str) -> tuple[str, list[str]] | None:
    """One place of `PLACES`, and the document's own key so two jobs never compact it at once.

    Both hold a token of this job's own, so a job that outlived its lease can't
    free a place another job has since taken.
    """
    redis = get_redis_conn()
    token = secrets.token_hex(16)
    own = f"suite:collab:compacting:{frappe.local.site}:{adapter}:{doc_id}"
    if not redis.set(own, token, nx=True, ex=LEASE):
        return None

    for index in range(PLACES):
        key = f"suite:collab:compaction:{index}"
        if redis.set(key, token, nx=True, ex=LEASE):
            return token, [key, own]

    redis.eval(RELEASE, 1, own, token)
    return None


def free_place(held: tuple[str, list[str]]) -> None:
    token, keys = held
    redis = get_redis_conn()
    for key in keys:
        redis.eval(RELEASE, 1, key, token)


def enough_memory() -> bool:
    """With every place compacting, 20% of the container must stay free. True where the cgroup can't be read."""
    try:
        with open(f"{CGROUP}/memory.max") as limit_file:
            max_text = limit_file.read().strip()
        with open(f"{CGROUP}/memory.stat") as stat_file:
            anon = next(int(line.split()[1]) for line in stat_file if line.startswith("anon "))
    except (OSError, StopIteration, ValueError):
        return True

    if max_text == "max":
        return True

    limit = int(max_text)
    return limit - anon - PLACES * PER_COMPACTION >= limit // 5


def limit_memory() -> None:
    """Cap this work horse's address space, on Linux and only in a forked horse."""
    if sbool(os.environ.get("FRAPPE_BACKGROUND_WORKERS_NOFORK", False)):
        return

    try:
        with open("/proc/self/status") as status:
            size = next(int(line.split()[1]) * 1024 for line in status if line.startswith("VmSize:"))
        resource.setrlimit(resource.RLIMIT_AS, (size + PER_COMPACTION, resource.RLIM_INFINITY))
    except (OSError, StopIteration, ValueError):
        pass
