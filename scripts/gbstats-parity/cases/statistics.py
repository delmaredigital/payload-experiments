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
from _gb import to_gb, from_gb


def cases() -> dict:
    from gbstats.models.statistics import (
        compute_covariance, compute_theta, create_theta_adjusted_statistics,
    )

    def prop(n, total):
        return {"type": "proportion", "n": n, "sum": total}

    def mean(n, total, squares):
        return {"type": "sampleMean", "n": n, "sum": total, "sumSquares": squares}

    def ra(post, pre, products, theta=None):
        return {"type": "regressionAdjusted", "n": post["n"], "post": post,
                "pre": pre, "postPreSumOfProducts": products, "theta": theta}

    inputs = []
    for n in (0, 1, 2, 1000, 10_000_000):
        for label, stat in (("p0", prop(n, 0)), ("p1", prop(n, n)),
                            ("p-half", prop(n, n / 2)),
                            ("positive", mean(n, 2 * n, 6 * n)),
                            ("negative", mean(n, -2 * n, 6 * n)),
                            ("negative-variance", mean(n, n, 0))):
            inputs.append((str(n) + "-" + label, stat))
        for theta in (None, 0, 0.23):
            for label, post, pre, products in (
                ("prop", prop(n, n / 2), prop(n, n / 4), n / 5),
                ("mean", mean(n, 2 * n, 6 * n), mean(n, n, 2 * n), 3 * n),
            ):
                inputs.append((str(n) + "-ra-" + label + "-" + str(theta),
                               ra(post, pre, products, theta)))
    # test_shared_models.py METRIC_1 and METRIC_3, preserving their input order.
    xs, ys = [0.3, 0.5, 0.9, 22], [2, 1, 5, 3]
    upstream = ra(mean(4, sum(ys), sum(y*y for y in ys)),
                  mean(4, sum(xs), sum(x*x for x in xs)),
                  sum(x*y for x, y in zip(xs, ys)))
    inputs.append(("upstream-shared-models", upstream))

    def access(attr):
        return [{"name": name, "input": {"args": [stat]},
                 "expected": getattr(to_gb(stat), attr)} for name, stat in inputs]

    invalid = ra(mean(2, 2, 4), prop(2, 1), 1)
    variances = access("variance")
    variances.append({"name": "mixed-pre-post-TypeError", "input": {"args": [invalid]},
                      "expected": raises(TypeError, to_gb, invalid)})
    covariance = []
    for n in (0, 1, 2, 1000, 10_000_000):
        for label, a, b in (("proportions", prop(n, n/2), prop(n, n/4)),
                            ("means", mean(n, -n, 2*n), mean(n, 2*n, 6*n)),
                            ("mixed", prop(n, n/2), mean(n, -n, 2*n))):
            args = [n, a, b, n / 5]
            covariance.append({"name": str(n) + "-" + label, "input": {"args": args},
                               "expected": compute_covariance(n, to_gb(a), to_gb(b), args[3])})
    a = ra(mean(1000, 2000, 6000), mean(1000, 1000, 2000), 2500)
    b = ra(mean(1000, 2200, 7000), mean(1000, 1100, 2400), 2900)
    pairs = [("cuped-means", a, b), ("upstream-shared-models", upstream, upstream),
             ("cuped-proportions", ra(prop(1000, 500), prop(1000, 300), 200),
              ra(prop(1000, 550), prop(1000, 320), 220)),
             ("zero-pre", ra(a["post"], mean(1000, 0, 0), 0),
              ra(b["post"], mean(1000, 0, 0), 0)),
             ("zero-post", ra(mean(1000, 0, 0), a["pre"], 0),
              ra(mean(1000, 0, 0), b["pre"], 0)),
             ("zero-covariance", ra(mean(2, 2, 4), mean(2, 2, 4), 2),
              ra(mean(2, 2, 4), mean(2, 2, 4), 2)),
             ("empty", ra(mean(0, 0, 0), mean(0, 0, 0), 0),
              ra(mean(0, 0, 0), mean(0, 0, 0), 0))]
    thetas = [{"name": name, "input": {"args": [x, y]},
               "expected": compute_theta(to_gb(x), to_gb(y))} for name, x, y in pairs]
    adjustments = []
    for name, x, y in pairs + [("explicit-zero", dict(a, theta=0), dict(b, theta=0)),
                               ("explicit-set", dict(a, theta=0.2), dict(b, theta=0.3)),
                               ("one-null", dict(a, theta=0), b),
                               ("mixed-RA-base", a, b["post"]),
                               ("base-pair", a["post"], b["post"])]:
        adjustments.append({"name": name, "input": {"args": [x, y]},
                            "expected": [from_gb(s) for s in create_theta_adjusted_statistics(to_gb(x), to_gb(y))]})
    for target in (thetas, adjustments):
        for label, x, y in (("invalid-a", invalid, a), ("invalid-b", a, invalid)):
            target.append({"name": label, "input": {"args": [x, y]},
                           "expected": raises(TypeError, lambda: (to_gb(x), to_gb(y)))})

    def fixture(symbol, rows):
        return {"module": "gbstats.models.statistics", "symbol": symbol, "cases": rows}

    return {
        "statistics.statisticMean": fixture("Statistic.mean", access("mean")),
        "statistics.statisticUnadjustedMean": fixture("Statistic.unadjusted_mean", access("unadjusted_mean")),
        "statistics.statisticVariance": fixture("Statistic.variance", variances),
        "statistics.statisticStddev": fixture("Statistic.stddev", access("stddev")),
        "statistics.computeCovariance": fixture("compute_covariance", covariance),
        "statistics.computeTheta": fixture("compute_theta", thetas),
        "statistics.createThetaAdjustedStatistics": fixture("create_theta_adjusted_statistics", adjustments),
    }
