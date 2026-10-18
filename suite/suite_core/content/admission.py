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
LEASE_SECONDS = TIMEOUT + 90
CGROUP = "/sys/fs/cgroup"

# Bench-wide places, held in RQ's Redis; a lease outlives the job timeout, so a killed horse frees its place
RELEASE_SCRIPT = (
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0"
)


def take_place(adapter: str, doc_id: str) -> tuple[str, list[str]] | None:
    """One place of `PLACES`, and the document's own key so two jobs never compact it at once.

    Both hold a token of this job's own, so a job that outlived its lease can't
    free a place another job has since taken.
    """
    redis = get_redis_conn()
    token = secrets.token_hex(16)
    doc_key = f"suite:collab:compacting:{frappe.local.site}:{adapter}:{doc_id}"
    if not redis.set(doc_key, token, nx=True, ex=LEASE_SECONDS):
        return None

    for index in range(PLACES):
        key = f"suite:collab:compaction:{index}"
        if redis.set(key, token, nx=True, ex=LEASE_SECONDS):
            return token, [key, doc_key]

    redis.eval(RELEASE_SCRIPT, 1, doc_key, token)
    return None


def free_place(place: tuple[str, list[str]]) -> None:
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
            anon_bytes = next(int(line.split()[1]) for line in stat_file if line.startswith("anon "))
    except (OSError, StopIteration, ValueError):
        return True

    if max_text == "max":
        return True

    limit = int(max_text)
    return limit - anon_bytes - PLACES * PER_COMPACTION >= limit // 5


def limit_memory() -> None:
    """Cap this work horse's address space, on Linux and only in a forked horse."""
    if sbool(os.environ.get("FRAPPE_BACKGROUND_WORKERS_NOFORK", False)):
        return

    try:
        with open("/proc/self/status") as status:
            address_space = next(int(line.split()[1]) * 1024 for line in status if line.startswith("VmSize:"))
        resource.setrlimit(resource.RLIMIT_AS, (address_space + PER_COMPACTION, resource.RLIM_INFINITY))
    except (OSError, StopIteration, ValueError):
        pass
