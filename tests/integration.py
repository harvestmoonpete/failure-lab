"""Run against a clean Compose app: python3 tests/integration.py."""

import json, time, urllib.request, urllib.error

BASE = "http://localhost:8081/api"


def call(path, body=None):
    req = urllib.request.Request(
        BASE + path,
        data=None if body is None else json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=10) as response:
        return json.load(response)


def settle():
    for _ in range(120):
        s = call("/snapshot")
        if all(j["stage"] in ("delivered", "dead") for j in s["jobs"]):
            return s
        time.sleep(1)
    raise AssertionError("Pipeline did not settle")


call("/reset", {})
for fault in ["none", "duplicate", "outage", "crash"]:
    call("/fault", {"fault": fault})
    call("/batches", {"count": 3, "key": fault})
    call("/batches", {"count": 3, "key": fault})
    s = settle()
    assert (
        len(s["jobs"])
        == (["none", "duplicate", "outage", "crash"].index(fault) + 1) * 3
    )
    for job in s["jobs"]:
        if job["stage"] == "delivered":
            assert (
                sum(
                    e["job_id"] == job["id"] and e["message"].startswith("Delivered")
                    for e in s["events"]
                )
                == 1
            )
            with urllib.request.urlopen(BASE + "/jobs/" + job["id"] + "/pdf") as r:
                assert r.read().startswith(b"%PDF")
    if fault == "outage":
        dead = [j for j in s["jobs"] if j["stage"] == "dead"]
        assert len(dead) == 1 and dead[0]["attempts"] == 3
        call("/jobs/" + dead[0]["id"] + "/replay", {})
        assert all(j["stage"] == "delivered" for j in settle()["jobs"])
assert all(j["stage"] == "delivered" for j in s["jobs"])
try:
    call("/jobs/" + s["jobs"][0]["id"] + "/replay", {})
except urllib.error.HTTPError as e:
    assert e.code == 409
else:
    raise AssertionError("Delivered replay must fail")
print(
    "PASS: all four scenarios, batch idempotency, partial progress, replay, one delivery per job, PDF validity"
)

for bad in [0, 21, 1.5]:
    try:
        call("/batches", {"count": bad, "key": "bad"})
    except urllib.error.HTTPError as e:
        assert e.code == 400
    else:
        raise AssertionError("Invalid batch count accepted")
try:
    call("/fault", {"fault": "unknown"})
except urllib.error.HTTPError as e:
    assert e.code == 400
else:
    raise AssertionError("Unknown fault accepted")
print("PASS: invalid inputs rejected")

for endpoint in ["/batches", "/fault"]:
    req = urllib.request.Request(
        BASE + endpoint, data=b"null", headers={"Content-Type": "application/json"}
    )
    try:
        urllib.request.urlopen(req, timeout=10)
    except urllib.error.HTTPError as error:
        assert error.code == 400
    else:
        raise AssertionError(f"{endpoint} accepted null body")
print("PASS: null request bodies rejected with 400")
