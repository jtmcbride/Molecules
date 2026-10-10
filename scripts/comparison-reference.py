#!/usr/bin/env python3
"""Independent superposition reference for Phase 4 (validation only; not run in CI).

Reads the paired Cα coordinates the application wrote to validation/comparison/*.pairs.json
(RECORD_COMPARISON_PAIRS=1 npx vitest run tests/comparison-superposition.test.ts) and fits
them with numpy's SVD (Kabsch, with the reflection correction), applying the same outlier
rejection policy as src/comparison/superposition.ts. Writes the "superposition" section of
validation/comparison.json, which the tests compare against the application's Horn fit.

    python scripts/comparison-reference.py
"""
import json
import math
import pathlib

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent
POLICY = {"maxCycles": 5, "rejectionFactor": 2.0, "minFraction": 0.5, "minAtoms": 10}


def kabsch(target, moving):
    ct, cm = target.mean(axis=0), moving.mean(axis=0)
    h = (moving - cm).T @ (target - ct)
    u, _, vt = np.linalg.svd(h)
    d = np.sign(np.linalg.det(vt.T @ u.T))
    r = vt.T @ np.diag([1.0, 1.0, d]) @ u.T
    return r, ct - r @ cm


def superpose(pairs):
    target = np.array([p["target"] for p in pairs], dtype=float)
    moving = np.array([p["moving"] for p in pairs], dtype=float)
    n = len(pairs)
    floor = max(POLICY["minAtoms"], math.ceil(POLICY["minFraction"] * n))
    active = list(range(n))
    r, t = kabsch(target[active], moving[active])
    cycles = 0

    def deviations(r, t):
        return np.linalg.norm(moving @ r.T + t - target, axis=1)

    for _ in range(POLICY["maxCycles"]):
        dev = deviations(r, t)
        core = math.sqrt(float(np.mean(dev[active] ** 2)))
        keep = [i for i in active if dev[i] <= POLICY["rejectionFactor"] * core]
        if len(keep) == len(active) or len(keep) < floor:
            break
        active = keep
        r, t = kabsch(target[active], moving[active])
        cycles += 1
    dev = deviations(r, t)
    kept = set(active)
    m = np.eye(4)
    m[:3, :3], m[:3, 3] = r, t
    return {
        "rmsdCore": math.sqrt(float(np.mean(dev[active] ** 2))),
        "rmsdAll": math.sqrt(float(np.mean(dev**2))),
        "fitted": len(active),
        "total": n,
        "cycles": cycles,
        "rejected": [pairs[i]["id"] for i in range(n) if i not in kept],
        # Column-major, as in the application.
        "transform": [float(x) for x in m.T.reshape(-1)],
    }


def main():
    out_path = ROOT / "validation" / "comparison.json"
    data = json.loads(out_path.read_text()) if out_path.exists() else {}
    data["superposition"] = {
        path.name.removesuffix(".pairs.json"): superpose(json.loads(path.read_text()))
        for path in sorted((ROOT / "validation" / "comparison").glob("*.pairs.json"))
    }
    data["superpositionTool"] = {
        "method": "numpy SVD (Kabsch) with reflection correction",
        "numpy": np.__version__,
        "policy": POLICY,
    }
    out_path.write_text(json.dumps(data, indent=1) + "\n")
    for name, r in data["superposition"].items():
        print(f"{name}: core {r['rmsdCore']:.3f} all {r['rmsdAll']:.3f} "
              f"fitted {r['fitted']}/{r['total']} cycles {r['cycles']}")


if __name__ == "__main__":
    main()
