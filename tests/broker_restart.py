"""Destructive local Compose restart test; run after integration.py."""

import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = "http://localhost:8081/api"


def compose(*args):
    return subprocess.check_output(
        ["docker", "compose", *args], cwd=ROOT, text=True
    ).strip()


def request(path, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        BASE + path, data=data, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=5) as response:
        return json.load(response)


def until(check, description, timeout=150):
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        try:
            result = check()
            if result:
                return result
        except Exception as error:
            last = error
        time.sleep(1)
    raise AssertionError(f"Timed out: {description}; last error: {last}")


request("/reset", {})
compose("stop", "worker")
try:
    request("/batches", {"count": 4, "key": "broker-restart-queued"})
    until(
        lambda: (
            compose(
                "exec",
                "-T",
                "db",
                "psql",
                "-U",
                "postgres",
                "-d",
                "failure",
                "-Atc",
                "SELECT count(*) FROM outbox WHERE sent=false",
            )
            == "0"
        ),
        "outbox confirms before restart",
    )
    before = request("/snapshot")
    ids = {job["id"] for job in before["jobs"]}
    assert len(ids) == 4
    assert all(job["stage"] == "validated" for job in before["jobs"])
    api_id = compose("ps", "-q", "api")
    original_count = int(
        subprocess.check_output(
            ["docker", "inspect", "--format", "{{.RestartCount}}", api_id], text=True
        )
    )
    if "--recreate" in sys.argv:
        compose("up", "-d", "--no-deps", "--force-recreate", "rabbit")
    else:
        compose("restart", "rabbit")
    until(lambda: request("/health")["ok"], "API reconnects to restarted broker")
    new_count = int(
        subprocess.check_output(
            ["docker", "inspect", "--format", "{{.RestartCount}}", api_id], text=True
        )
    )
    assert new_count > original_count, (
        "API must restart instead of keeping a closed channel"
    )
finally:
    compose("start", "worker")


def settled():
    state = request("/snapshot")
    return state if all(job["stage"] == "delivered" for job in state["jobs"]) else False


recovered = until(settled, "durable queued jobs recover")
assert {job["id"] for job in recovered["jobs"]} == ids
request("/batches", {"count": 2, "key": "broker-restart-new"})
state = until(settled, "new submissions progress after restart")
assert len(state["jobs"]) == 6
for job in state["jobs"]:
    assert (
        sum(
            event["job_id"] == job["id"] and event["message"].startswith("Delivered")
            for event in state["events"]
        )
        == 1
    )
print(
    "PASS: broker restart reconnects API, retains confirmed queued work, and accepts new work without duplicate delivery"
)
