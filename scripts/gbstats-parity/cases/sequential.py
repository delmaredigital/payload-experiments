"""Sequential tests at the pinned gbstats revision; evaluated on the fixture train."""
from __future__ import annotations

import importlib.util
from pathlib import Path
import sys

# generate.py loads modules by path under -I, without cases/ on sys.path.
if "_gb" not in sys.modules:
    _spec = importlib.util.spec_from_file_location("_gb", Path(__file__).with_name("_gb.py"))
    _module = importlib.util.module_from_spec(_spec)
    sys.modules["_gb"] = _module
    _spec.loader.exec_module(_module)

from _gb import to_gb, freq_ts


def cases() -> dict:
    import numpy as np
    from gbstats.frequentist.tests import (
        SequentialConfig, SequentialTwoSidedTTest,
        SequentialOneSidedTreatmentGreaterTTest, SequentialOneSidedTreatmentLesserTTest,
        sequential_rho, sequential_interval_halfwidth, sequential_interval_halfwidth_one_sided,
    )
    from gbstats.utils import is_statistically_significant

    def mean(n, average, variance):
        return {"type": "sampleMean", "n": n, "sum": n * average,
                "sumSquares": variance * (n - 1) + n * average ** 2}

    def ra(post, pre, products, theta=None):
        return {"type": "regressionAdjusted", "n": post["n"], "post": post,
                "pre": pre, "postPreSumOfProducts": products, "theta": theta}

    a = mean(1000, 2, 2)
    b = mean(1300, 2.2, 2.1)
    cuped_a = ra(a, mean(1000, 1, 1), 2500)
    cuped_b = ra(b, mean(1300, 1.1, 1.1), 3770)
    pairs = [
        ("sample-means", a, b),
        ("proportions", {"type": "proportion", "n": 1000, "sum": 200},
         {"type": "proportion", "n": 1300, "sum": 290}),
        ("cuped", cuped_a, cuped_b),
        ("theta-zero-revert", ra(a, mean(1000, 0, 0), 0), ra(b, mean(1300, 0, 0), 0)),
        ("small-n-50", mean(50, 2, 1), mean(50, 2.2, 1.2)),
        ("large-n-1e7-exp-overflow", mean(10_000_000, 2, 1), mean(10_000_000, 2.2, 1.2)),
        # Each one-sided class sees both clamped early exits, in opposite orders.
        ("clearly-beneficial", mean(10000, 2, 1), mean(10000, 4, 1)),
        ("clearly-harmful", mean(10000, 4, 1), mean(10000, 2, 1)),
        # Effects between the min/max-alpha bounds exercise the bisection.
        ("near-greater-boundary", mean(1000, 2, 1), mean(1000, 2.12, 1)),
        ("near-lesser-boundary", mean(1000, 2.12, 1), mean(1000, 2, 1)),
        ("identical", a, a),
        ("variance-error", mean(50, 2, 0), b),
        ("baseline-error", mean(50, 0, 1), b),
        ("empty-error", mean(0, 0, 0), b),
        ("mixed-RA-error", dict(cuped_a, theta=0), b),
    ]

    def evaluate(test, x, y, cfg):
        kwargs = {"alpha": cfg.get("alpha", 0.05),
                  "difference_type": cfg.get("differenceType", "relative"),
                  "test_value": cfg.get("testValue", 0),
                  "sequential_tuning_parameter": cfg.get("sequentialTuningParameter", 5000),
                  "rho": cfg.get("rho")}
        # Match numpy's overflow semantics: exp -> inf and 1/inf -> 0, no cap
        # or log-space rewrite. The large-n two-sided case records this result.
        with np.errstate(over="ignore", invalid="ignore", divide="ignore"):
            return freq_ts(test([(to_gb(x), to_gb(y))], SequentialConfig(**kwargs)).compute_result())

    def row(test, name, x, y, cfg):
        return {"name": name, "input": {"args": [x, y, cfg]},
                "expected": evaluate(test, x, y, cfg)}

    def test_rows(test):
        rows = []
        for name, x, y in pairs:
            for alpha in (0.05, 0.05 / 3, 0.01):
                for tuning in (100, 5000, 1e6):
                    for difference in ("relative", "absolute"):
                        for test_value in (0, 0.07):
                            cfg = {"alpha": alpha, "differenceType": difference,
                                   "sequentialTuningParameter": tuning, "testValue": test_value}
                            suffix = "-".join(map(str, (alpha, tuning, difference, test_value)))
                            rows.append(row(test, name + "-" + suffix, x, y, cfg))
        for rho in (0.001, 0.04, 0.3):
            for difference in ("relative", "absolute"):
                cfg = {"rho": rho, "alpha": 0.05, "differenceType": difference, "testValue": 0.07}
                rows.append(row(test, "explicit-rho-" + str(rho) + "-" + difference, a, b, cfg))
        # Error precedence: invalid moments must beat the alpha >= 0.5 guard.
        for alpha in (0.5, 0.8):
            for name, x in (("valid", a), ("moments-error", mean(50, 2, 0))):
                rows.append(row(test, "alpha-guard-" + str(alpha) + "-" + name, x, b,
                                {"alpha": alpha, "testValue": 0.07}))
        rows.append({"name": "default-config", "input": {"args": [a, b]},
                     "expected": freq_ts(test([(to_gb(a), to_gb(b))]).compute_result())})
        # Non-finite moments give NaN CI bounds deterministically, unlike
        # finite large-scale inputs whose convergence depends on libm rounding.
        inf = float("inf")
        for difference in ("absolute", "relative"):
            rows.append(row(test, "non-converged-nan-ci-" + difference, mean(100, 2, 1),
                            {"type": "sampleMean", "n": 100, "sum": inf, "sumSquares": inf},
                            {"differenceType": difference}))
            if test is not SequentialTwoSidedTTest:
                assert rows[-1]["expected"]["pValue"] is None
                assert rows[-1]["expected"]["pValueErrorMessage"] == "NUMERICAL_PVALUE_NOT_CONVERGED"
        return rows

    def test_fixture(test):
        return {"module": "gbstats.frequentist.tests", "symbol": test.__name__, "cases": test_rows(test)}

    rho_rows = []
    for alpha in (0.05, 0.05 / 3, 0.01):
        for tuning in (100, 5000, 1e6):
            for two_sided in (True, False):
                rho_rows.append({"name": str((alpha, tuning, two_sided)),
                                 "input": {"args": [alpha, tuning, two_sided]},
                                 "expected": sequential_rho(alpha, tuning, two_sided)})
    rho_rows.append({"name": "default-two-sided", "input": {"args": [0.05, 5000]},
                     "expected": sequential_rho(0.05, 5000)})

    def halfwidth_rows(fn):
        rows = []
        for s2 in (0, 0.4, 20):
            for n in (50, 2000, 10_000_000):
                for tuning in (100, 5000, 1e6):
                    for alpha in (0.05, 0.05 / 3, 0.01):
                        for rho in (None, 0.04):
                            args = [s2, n, tuning, alpha] + ([] if rho is None else [rho])
                            rows.append({"name": str(args), "input": {"args": args}, "expected": fn(*args)})
        return rows

    intervals = [[-1, 1], [0, 1], [-1, 0], [0, 0], [0.1, 1], [-1, -0.1],
                 [-np.inf, 1], [-np.inf, -0.1], [0.1, np.inf], [-1, np.inf], [-np.inf, np.inf]]
    return {
        "sequential.sequentialTwoSidedTTest": test_fixture(SequentialTwoSidedTTest),
        "sequential.sequentialOneSidedTreatmentGreaterTTest": test_fixture(SequentialOneSidedTreatmentGreaterTTest),
        "sequential.sequentialOneSidedTreatmentLesserTTest": test_fixture(SequentialOneSidedTreatmentLesserTTest),
        "sequential.sequentialRho": {"module": "gbstats.frequentist.tests", "symbol": "sequential_rho", "cases": rho_rows},
        "sequential.sequentialIntervalHalfwidth": {"module": "gbstats.frequentist.tests", "symbol": "sequential_interval_halfwidth", "cases": halfwidth_rows(sequential_interval_halfwidth)},
        "sequential.sequentialIntervalHalfwidthOneSided": {"module": "gbstats.frequentist.tests", "symbol": "sequential_interval_halfwidth_one_sided", "cases": halfwidth_rows(sequential_interval_halfwidth_one_sided)},
        "sequential.isStatisticallySignificant": {"module": "gbstats.utils", "symbol": "is_statistically_significant", "cases": [
            {"name": str(ci), "input": {"args": [ci]}, "expected": is_statistically_significant(ci)} for ci in intervals]},
    }
