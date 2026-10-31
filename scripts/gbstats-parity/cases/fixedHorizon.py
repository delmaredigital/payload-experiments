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

from _gb import to_gb, freq_ts


def cases() -> dict:
    from gbstats.frequentist.tests import (
        TwoSidedTTest, OneSidedTreatmentGreaterTTest, OneSidedTreatmentLesserTTest,
        FrequentistConfig,
    )

    def mean(n, total, squares):
        return {"type": "sampleMean", "n": n, "sum": total, "sumSquares": squares}

    def ra(post, pre, products, theta=None):
        return {"type": "regressionAdjusted", "n": post["n"], "post": post,
                "pre": pre, "postPreSumOfProducts": products, "theta": theta}

    # Upstream tests/frequentist/test_tests.py sample-mean, binomial, CUPED.
    a = mean(3407, 1396.87, 52377.9767)
    b = mean(3461, 2422.7, 134698.29)
    cuped_a = ra(mean(3000, 1396.87, 52377.9767), mean(3000, 16.87, 527.9767), 1)
    cuped_b = ra(b, mean(3461, 22.7, 1348.29), 1)
    pairs = [
        ("upstream-means", a, b),
        ("upstream-proportions", {"type": "proportion", "n": 28, "sum": 14},
         {"type": "proportion", "n": 30, "sum": 16}),
        ("unequal-n-Welch", mean(12, 24, 80), mean(157, 400, 1600)),
        ("upstream-cuped", cuped_a, cuped_b),
        ("theta-zero-revert", ra(a, mean(3407, 0, 0), 0), ra(b, mean(3461, 0, 0), 0)),
        ("identical-arms", a, a),
        ("negative-baseline", mean(100, -100, 200), mean(200, -180, 400)),
        ("large-n", mean(10_000_000, 20_000_000, 60_000_000),
         mean(10_000_000, 22_000_000, 70_000_000)),
        ("upstream-negative-variance-error", mean(2, 1396.87, 52377.9767), b),
        ("empty-error", mean(0, 0, 0), b),
        ("singleton-error", mean(1, 1, 1), b),
        ("baseline-error", mean(100, 0, 100), b),
        ("mixed-RA-error", dict(cuped_a, theta=0), b),
    ]

    def rows(test):
        result = []
        for name, x, y in pairs:
            for alpha in (0.05, 0.01, 0.1):
                for difference in ("relative", "absolute"):
                    for test_value in (0, 0.1):
                        cfg = {"alpha": alpha, "differenceType": difference, "testValue": test_value}
                        output = test([(to_gb(x), to_gb(y))], FrequentistConfig(
                            alpha=alpha, difference_type=difference, test_value=test_value)).compute_result()
                        result.append({"name": name + "-" + str(alpha) + "-" + difference + "-" + str(test_value),
                                       "input": {"args": [x, y, cfg]}, "expected": freq_ts(output)})
        result.append({"name": "default-config", "input": {"args": [a, b]},
                       "expected": freq_ts(test([(to_gb(a), to_gb(b))]).compute_result())})
        return result

    def fixture(test):
        return {"module": "gbstats.frequentist.tests", "symbol": test.__name__, "cases": rows(test)}

    return {
        "fixedHorizon.twoSidedTTest": fixture(TwoSidedTTest),
        "fixedHorizon.oneSidedTreatmentGreaterTTest": fixture(OneSidedTreatmentGreaterTTest),
        "fixedHorizon.oneSidedTreatmentLesserTTest": fixture(OneSidedTreatmentLesserTTest),
    }
