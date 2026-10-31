from __future__ import annotations

import importlib.util
from pathlib import Path
import sys

# generate.py loads case modules by path under -I, without cases/ on sys.path.
if "_gb" not in sys.modules:
    _spec = importlib.util.spec_from_file_location("_gb", Path(__file__).with_name("_gb.py"))
    _module = importlib.util.module_from_spec(_spec)
    sys.modules["_gb"] = _module
    _spec.loader.exec_module(_module)

from _common import raises
from _gb import to_gb, moments_ts


def cases() -> dict:
    from gbstats.frequentist.tests import TwoSidedTTest, FrequentistConfig

    def mean(n, total, squares):
        return {"type": "sampleMean", "n": n, "sum": total, "sumSquares": squares}

    def prop(n, total):
        return {"type": "proportion", "n": n, "sum": total}

    def ra(post, pre, products, theta=None):
        return {"type": "regressionAdjusted", "n": post["n"], "post": post,
                "pre": pre, "postPreSumOfProducts": products, "theta": theta}

    # tests/frequentist/test_tests.py TwoSidedTTest and sequential CUPED inputs.
    a = mean(3407, 1396.87, 52377.9767)
    b = mean(3461, 2422.7, 134698.29)
    cuped_a = ra(mean(3000, 1396.87, 52377.9767), mean(3000, 16.87, 527.9767), 1)
    cuped_b = ra(b, mean(3461, 22.7, 1348.29), 1)
    small = mean(100, 100, 200)
    other = mean(100, 120, 250)
    adjusted_zero = ra(small, small, 100, 1)
    unadjusted_zero = ra(mean(100, 0, 100), small, 0, 0.5)
    invalid = ra(small, prop(100, 50), 50)
    pairs = [
        ("upstream-means", a, b), ("upstream-proportions", prop(28, 14), prop(30, 16)),
        ("upstream-cuped", cuped_a, cuped_b),
        ("cuped-proportions", ra(prop(1000, 500), prop(1000, 300), 200),
         ra(prop(1000, 550), prop(1000, 320), 220)),
        ("cuped-explicit-zero", dict(cuped_a, theta=0), dict(cuped_b, theta=0)),
        ("cuped-explicit-set", dict(cuped_a, theta=0.2), dict(cuped_b, theta=0.2)),
        ("theta-zero-revert", ra(small, mean(100, 0, 0), 0),
         ra(other, mean(100, 0, 0), 0)),
        ("large-n", mean(10_000_000, 20_000_000, 60_000_000),
         mean(10_000_000, 22_000_000, 70_000_000)),
        ("negative-baseline", mean(100, -100, 200), other),
        ("cuped-negative-baseline", ra(mean(100, -100, 200), small, -100, 0.2),
         ra(mean(100, -80, 180), other, -100, 0.2)),
        ("empty-zero-variance-first", mean(0, 0, 0), b),
        ("singleton-zero-variance", mean(1, 1, 1), b),
        ("negative-variance", mean(2, 100, 1), b),
        ("proportion-zero", prop(100, 0), prop(100, 50)),
        ("proportion-one", prop(100, 100), prop(100, 50)),
        ("adjusted-baseline-zero", adjusted_zero, ra(other, small, 100, 1)),
        ("unadjusted-baseline-zero", unadjusted_zero, ra(other, small, 100, 0.5)),
        ("mixed-a-RA", dict(cuped_a, theta=0), b),
        ("mixed-b-RA", a, dict(cuped_b, theta=0)),
        ("variance-before-mixed", ra(mean(100, 0, 0), small, 0, 0), b),
        ("baseline-before-mixed", adjusted_zero, other),
    ]
    rows = []
    for name, x, y in pairs:
        for difference in ("relative", "absolute"):
            # BaseABTest init performs theta adjustment; taking its moments avoids
            # executing the fixed-horizon result or any test-only reference math.
            result = TwoSidedTTest([(to_gb(x), to_gb(y))],
                                  FrequentistConfig(difference_type=difference)).moments_result
            rows.append({"name": name + "-" + difference,
                         "input": {"args": [x, y, difference]}, "expected": moments_ts(result)})
    rows.append({"name": "default-relative", "input": {"args": [a, b]},
                 "expected": moments_ts(TwoSidedTTest([(to_gb(a), to_gb(b))]).moments_result)})
    for name, x, y in (("invalid-a", invalid, b), ("invalid-b", a, invalid)):
        rows.append({"name": name, "input": {"args": [x, y]},
                     "expected": raises(TypeError, lambda: (to_gb(x), to_gb(y)))})
    return {
        "moments.abTestMoments": {"module": "gbstats.models.tests",
                                  "symbol": "BaseABTest.compute_moments_result", "cases": rows},
    }
