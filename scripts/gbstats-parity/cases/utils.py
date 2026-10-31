from __future__ import annotations


def cases() -> dict:
    from gbstats.utils import (
        frequentist_diff, frequentist_variance, variance_of_ratios,
        gaussian_credible_interval,
    )

    def rows(fn, inputs):
        return [{"name": name, "input": {"args": args}, "expected": fn(*args)}
                for name, args in inputs]

    def fixture(symbol, fn, inputs):
        return {"module": "gbstats.utils", "symbol": symbol, "cases": rows(fn, inputs)}

    return {
        "utils.frequentistDiff": fixture("frequentist_diff", frequentist_diff, [
            ("relative-default-unadjusted", [2, 3, True]),
            ("absolute", [2, 3, False]), ("negative-baseline", [-2, -1, True]),
            ("zero-unadjusted-falsy", [2, 3, True, 0]),
            ("set-unadjusted", [2, 3, True, 4]),
            ("negative-unadjusted", [2, 3, True, -4]),
            ("zero-absolute", [0, 3, False]),
        ]),
        "utils.frequentistVariance": fixture("frequentist_variance", frequentist_variance, [
            ("relative", [2, 3, 100, 4, 5, 250, True]),
            ("absolute", [2, 3, 100, 4, 5, 250, False]),
            ("negative-baseline", [2, -3, 100, 4, -5, 250, True]),
            ("zero-baseline", [2, 0, 100, 4, 5, 250, True]),
            ("large-n", [2, 3, 10_000_000, 4, 5, 10_000_000, True]),
            ("singleton", [2, 3, 1, 4, 5, 1, False]),
        ]),
        "utils.varianceOfRatios": fixture("variance_of_ratios", variance_of_ratios, [
            ("zero-denominator", [2, 3, 0, 4, 1]),
            ("positive", [2, 3, 4, 5, 1]),
            ("negative-denominator", [2, 3, -4, 5, -1]),
            ("zero-numerator", [0, 3, 4, 5, 1]),
            ("negative-covariance", [-2, 3, 4, 5, -1]),
        ]),
        "utils.gaussianCredibleInterval": fixture("gaussian_credible_interval", gaussian_credible_interval, [
            ("standard", [0, 1, 0.05]), ("shift-scale", [4, 2, 0.01]),
            ("negative-mean", [-10, 0.3, 0.1]),
            ("large-location", [1e7, 0.01, 0.05]),
            ("small-alpha", [0.01, 100, 1e-6]),
        ]),
    }
