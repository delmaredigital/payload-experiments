"""EffectBayesianABTest and one-sided truncated means at the pinned gbstats SHA."""
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

from _gb import to_gb


def cases() -> dict:
    from gbstats.bayesian.tests import (
        EffectBayesianABTest, EffectBayesianConfig, GaussianPrior,
    )
    from gbstats.utils import truncated_normal_mean

    def mean(n, total, squares):
        return {"type": "sampleMean", "n": n, "sum": total, "sumSquares": squares}

    def prop(n, total):
        return {"type": "proportion", "n": n, "sum": total}

    def ra(post, pre, products, theta=None):
        return {"type": "regressionAdjusted", "n": post["n"], "post": post,
                "pre": pre, "postPreSumOfProducts": products, "theta": theta}

    def result_ts(result):
        return {"chanceToWin": float(result.chanceToWin),
                "expected": float(result.expected),
                "ci": [float(x) for x in result.ci],
                "uplift": {"dist": result.uplift.dist,
                           "mean": float(result.uplift.mean),
                           "stddev": float(result.uplift.stddev)},
                "risk": [float(x) for x in result.risk],
                "errorMessage": result.errorMessage, "riskType": result.riskType}

    def effect_row(name, a, b, config=None):
        args = [a, b]
        if config is None:
            test = EffectBayesianABTest([(to_gb(a), to_gb(b))])
        else:
            args.append(config)
            prior = config.get("priorEffect", {})
            test = EffectBayesianABTest([(to_gb(a), to_gb(b))], EffectBayesianConfig(
                alpha=config.get("alpha", 0.05),
                difference_type=config.get("differenceType", "relative"),
                inverse=config.get("inverse", False),
                prior_type=config.get("priorType", "relative"),
                prior_effect=GaussianPrior(**prior),
            ))
        return {"name": name, "input": {"args": args}, "expected": result_ts(test.compute_result())}

    # Upstream frequentist test inputs exercise the shared theta-adjusted path.
    a = mean(3407, 1396.87, 52377.9767)
    b = mean(3461, 2422.7, 134698.29)
    cuped_a = ra(mean(3000, 1396.87, 52377.9767), mean(3000, 16.87, 527.9767), 1)
    cuped_b = ra(b, mean(3461, 22.7, 1348.29), 1)
    large_a = mean(10_000_000, 20_000_000, 60_000_000)
    large_b = mean(10_000_000, 22_000_000, 70_000_000)
    small_a = mean(1000, 2000, 6000)
    # z ~ 8: CTW near either endpoint while still using the truncated-risk branch.
    near_b = mean(1000, 2500, 8250)
    pairs = [
        ("means", a, b), ("proportions", prop(28, 14), prop(30, 16)),
        ("identical", a, a), ("cuped-inferred", cuped_a, cuped_b),
        ("cuped-proportions", ra(prop(1000, 500), prop(1000, 300), 200),
         ra(prop(1000, 550), prop(1000, 320), 220)),
        ("cuped-explicit", dict(cuped_a, theta=0.2), dict(cuped_b, theta=0.2)),
        ("cuped-one-null", cuped_a, dict(cuped_b, theta=0.2)),
        ("theta-zero-revert", ra(a, mean(a["n"], 0, 0), 0),
         ra(b, mean(b["n"], 0, 0), 0)),
        ("negative-baseline", mean(100, -100, 200), mean(100, -80, 180)),
        ("ctw-near-one", small_a, near_b), ("ctw-near-zero", near_b, small_a),
        ("risk-positive-limit", large_a, large_b),
        ("risk-negative-limit", large_b, large_a),
        # Zero data variance is rejected by EffectMoments before posterior
        # computation; include both proper and improper priors in the matrix.
        ("zero-data-variance-error", mean(100, 100, 100), mean(100, 200, 400)),
        # The absolute-test/relative-prior zero-baseline check is likewise
        # preceded by EffectMoments' baseline check. Expected errors are upstream's.
        ("zero-baseline-error", mean(100, 0, 100), b),
        ("adjusted-baseline-error", ra(small_a, small_a, 4000, 1),
         ra(near_b, small_a, 4000, 1)),
        ("unadjusted-baseline-error", ra(mean(1000, 0, 2000), small_a, 0, 0.5),
         ra(near_b, small_a, 4000, 0.5)),
        ("negative-variance-error", mean(2, 100, 1), b),
        ("empty-error", mean(0, 0, 0), b),
        ("mixed-a-error", dict(cuped_a, theta=0), b),
        ("mixed-b-error", a, dict(cuped_b, theta=0)),
    ]
    priors = [
        ("improper", {}),
        ("proper-relative", {"priorType": "relative",
                             "priorEffect": {"mean": 0.1, "variance": 0.09, "proper": True}}),
        # Relative tests keep this absolute prior unchanged: upstream compares
        # the config object itself to "absolute", so the rescale branch is a no-op.
        ("proper-absolute-quirk", {"priorType": "absolute",
                                   "priorEffect": {"mean": -0.1, "variance": 0.04, "proper": True}}),
    ]
    effect_rows = [effect_row("default-improper-prior", a, b)]
    for name, x, y in pairs:
        for difference in ("relative", "absolute"):
            for prior_name, prior in priors:
                for inverse in (False, True):
                    for alpha in (0.05, 0.1):
                        config = dict(prior, differenceType=difference, inverse=inverse, alpha=alpha)
                        suffix = "-" + difference + "-" + prior_name + "-" + str(inverse) + "-" + str(alpha)
                        effect_rows.append(effect_row(name + suffix, x, y, config))

    truncated_rows = []
    bounds = (-37, -20, -10, -3, -1, -0.1, 0, 0.1, 1, 3, 10, 20, 37)
    for mu, sigma in ((0, 1), (4, 2), (-3, 0.5)):
        for z in bounds:
            bound = mu + sigma * z
            for side, lo, hi in (("lower", float("-inf"), bound),
                                 ("upper", bound, float("inf"))):
                args = [mu, sigma, lo, hi]
                truncated_rows.append({"name": side + "-" + str(mu) + "-" + str(sigma) + "-" + str(z),
                                       "input": {"args": args},
                                       "expected": float(truncated_normal_mean(*args))})
        # At the threshold and at >= 1e9 use only the patched Mills branch;
        # never sample scipy's silent-wrong region 1e4 < |bound| < 1e9.
        for z in (1000, 2000, 1e9):
            for side, lo, hi in (("mills-lower", float("-inf"), mu - sigma * z),
                                 ("mills-upper", mu + sigma * z, float("inf"))):
                args = [mu, sigma, lo, hi]
                truncated_rows.append({"name": side + "-" + str(mu) + "-" + str(sigma) + "-" + str(z),
                                       "input": {"args": args},
                                       "expected": float(truncated_normal_mean(*args))})

    return {
        "bayesian.effectBayesianABTest": {"module": "gbstats.bayesian.tests",
                                         "symbol": "EffectBayesianABTest", "cases": effect_rows},
        "bayesian.truncatedNormalMean": {"module": "gbstats.utils",
                                         "symbol": "truncated_normal_mean", "cases": truncated_rows},
    }
