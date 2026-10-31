from __future__ import annotations

from _common import raises


def cases() -> dict:
    import math

    import numpy as np
    from gbstats.models.statistics import ProportionStatistic, SampleMeanStatistic

    def case(name, args, reference):
        return {"name": name, "input": {"args": args}, "expected": reference(*args)}

    def error_case(name, args, reference):
        return {"name": name, "input": {"args": args},
                "expected": raises(ValueError, reference, *args)}

    def percentile(values, p):
        if not 0 < p < 1 or not all(math.isfinite(v) for v in values):
            raise ValueError("percentile requires 0 < p < 1 and finite values")
        if not values:
            return None
        return np.quantile(np.array(values, dtype=float), p, method="linear")

    def sum_left(values):
        # CPython 3.12's built-in sum compensates floats. Explicit += preserves
        # the required left-to-right order, matching TypeScript (no math.fsum).
        total = 0.0
        for value in values:
            total += value
        return total

    def cap(values, threshold):
        capped = list(values) if threshold is None else [min(v, threshold) for v in values]
        return {"values": capped, "threshold": threshold,
                "cappedCount": 0 if threshold is None else sum(v > threshold for v in values),
                "uncappedTotal": sum_left(values), "cappedTotal": sum_left(capped)}

    def summarize(values):
        total = 0.0
        squares = 0.0
        for value in values:
            total += value
            squares += value * value
        return {"n": len(values), "sum": total, "sumSquares": squares}

    def summarize_covariate(values, covariates):
        if len(values) != len(covariates):
            raise ValueError("values and covariates must have the same length")
        total = squares = pre_total = pre_squares = products = 0.0
        for value, covariate in zip(values, covariates):
            total += value
            squares += value * value
            pre_total += covariate
            pre_squares += covariate * covariate
            products += value * covariate
        return {"n": len(values), "sum": total, "sumSquares": squares,
                "preSum": pre_total, "preSumSquares": pre_squares,
                "postPreSumOfProducts": products}

    def build(kind, moments):
        n, total, squares = moments["n"], moments["sum"], moments["sumSquares"]
        mean = total / n if n else 0.0
        if kind == "binomial":
            if not (squares == total and total <= n):
                raise ValueError("binomial moments must represent per-unit 0/1 values")
            result = {"type": "proportion", "n": n, "sum": total}
            upstream = ProportionStatistic(n=n, sum=total)
            variance = mean * (1 - mean)
        else:
            result = {"type": "sampleMean", "n": n, "sum": total, "sumSquares": squares}
            upstream = SampleMeanStatistic(n=n, sum=total, sum_squares=squares)
            variance = (squares - total ** 2 / n) / (n - 1) if n > 1 else 0.0
        # Sanity link to the pinned gbstats constructors/accessors. These checks
        # stay in Python; fixtures contain only the TS-shaped statistic objects.
        assert upstream.n == n and upstream.sum == total
        assert upstream.mean == mean
        assert math.isclose(upstream.variance, variance, rel_tol=1e-12, abs_tol=1e-12)
        return result

    def build_adjusted(kind, moments):
        return {"type": "regressionAdjusted", "n": moments["n"],
                "post": build(kind, moments),
                "pre": build(kind, {"n": moments["n"], "sum": moments["preSum"],
                                    "sumSquares": moments["preSumSquares"]}),
                "postPreSumOfProducts": moments["postPreSumOfProducts"], "theta": None}

    def bonferroni(alpha, k):
        if not (math.isfinite(k) and k >= 1 and k == math.floor(k) and 0 < alpha < 1):
            raise ValueError("Bonferroni requires integer k >= 1 and 0 < alpha < 1")
        return alpha / k

    rng = np.random.default_rng(20261030)
    gifts = rng.lognormal(mean=4.0, sigma=2.0, size=1000).tolist()
    percentile_inputs = [
        ("singleton", [25.0]),
        ("pair", [10.0, 90.0]),
        ("seven-unsorted", [90.0, 1.0, 15.0, 3.0, 100.0, 30.0, 2.0]),
        ("gifts-1000", gifts),
        ("ties", [0.0, 10.0, 10.0, 10.0, 30.0, 30.0, 100.0]),
        ("negatives", [-1.0, -100.0, -20.0, -5.0, -3.0, -50.0, -2.0]),
        ("all-equal", [7.0] * 7),
        ("empty", []),
    ]
    percentile_cases = [
        case(name + "-p" + str(p), [values, p], percentile)
        for name, values in percentile_inputs
        for p in (0.5, 0.9, 0.95, 0.99, 0.999)
    ]
    percentile_cases.extend([
        error_case("p-zero", [[1.0, 2.0], 0.0], percentile),
        error_case("p-one", [[1.0, 2.0], 1.0], percentile),
        error_case("nan-value", [[1.0, float("nan")], 0.9], percentile),
        error_case("infinite-value", [[1.0, float("inf")], 0.9], percentile),
        error_case("negative-infinite-value", [[1.0, float("-inf")], 0.9], percentile),
        error_case("nan-p", [[1.0], float("nan")], percentile),
        error_case("invalid-p-empty", [[], 0.0], percentile),
    ])

    cap_input = [-5.0, 0.0, 3.0, 3.0, 10.0, 100.0]
    cap_cases = [
        case(name, [cap_input, threshold], cap)
        for name, threshold in [("null", None), ("below-all", -10.0),
                                ("inside", 5.0), ("above-all", 200.0), ("equal", 3.0)]
    ]
    cap_cases.extend([
        case("empty-null", [[], None], cap),
        case("empty-threshold", [[], 3.0], cap),
        case("ordered-totals", [[1e16, 1.0, -1e16, 2.0], 1e16], cap),
        case("gifts", [gifts, float(percentile(gifts, 0.99))], cap),
    ])

    # Signed magnitudes from 1e-3 to 1e6 expose float-order differences.
    large_values = (10.0 ** rng.uniform(-3.0, 6.0, 10000)
                    * rng.choice([-1.0, 1.0], 10000)).tolist()
    large_covariates = (10.0 ** rng.uniform(-3.0, 6.0, 10000)
                        * rng.choice([-1.0, 1.0], 10000)).tolist()
    unit_inputs = [
        ("empty", []), ("singleton", [3.5]),
        ("binomial", [0.0, 1.0, 1.0, 0.0]),
        ("ties-negative", [-5.0, 3.0, 3.0, 10.0]),
        ("ordered-sum", [1e16, 1.0, -1e16, 2.0]),
        ("seeded-10000", large_values),
    ]
    unit_cases = [case(name, [values], summarize) for name, values in unit_inputs]
    covariate_cases = [
        case("empty", [[], []], summarize_covariate),
        case("singleton", [[3.5], [-2.0]], summarize_covariate),
        case("binomial", [[0.0, 1.0, 1.0, 0.0], [1.0, 0.0, 1.0, 0.0]], summarize_covariate),
        case("signed", [[-5.0, 3.0, 3.0, 10.0], [2.0, -1.0, 5.0, 0.0]], summarize_covariate),
        case("ordered-products", [[1e16, 1.0, -1e16, 2.0], [1.0] * 4], summarize_covariate),
        case("seeded-10000", [large_values, large_covariates], summarize_covariate),
        error_case("missing-covariate", [[1.0], []], summarize_covariate),
        error_case("extra-covariate", [[], [1.0]], summarize_covariate),
    ]

    builder_cases = []
    adjusted_cases = []
    for kind in ("binomial", "count", "revenue"):
        outcomes = [0.0, 1.0, 1.0, 0.0] if kind == "binomial" else [-5.0, 2.0, 10.0, 100.0]
        covariates = [1.0, 0.0, 1.0, 0.0] if kind == "binomial" else [0.0, 3.0, -2.0, 50.0]
        for name, values, pre in [("empty", [], []), ("singleton", outcomes[:1], covariates[:1]),
                                  ("mixed", outcomes, covariates), ("zero", [0.0] * 4, [0.0] * 4)]:
            builder_cases.append(case(kind + "-" + name, [kind, summarize(values)], build))
            adjusted_cases.append(case(kind + "-" + name,
                                       [kind, summarize_covariate(values, pre)], build_adjusted))

    for name, invalid in [("not-01", {"n": 3, "sum": 2.0, "sumSquares": 4.0}),
                          ("sum-exceeds-n", {"n": 1, "sum": 2.0, "sumSquares": 2.0})]:
        builder_cases.append(error_case(name, ["binomial", invalid], build))
        valid = {"n": invalid["n"], "sum": 1.0, "sumSquares": 1.0}
        adjusted_cases.append(error_case(name + "-post", ["binomial", {
            **invalid, "preSum": 1.0, "preSumSquares": 1.0, "postPreSumOfProducts": 1.0,
        }], build_adjusted))
        adjusted_cases.append(error_case(name + "-pre", ["binomial", {
            **valid, "preSum": invalid["sum"], "preSumSquares": invalid["sumSquares"],
            "postPreSumOfProducts": 1.0,
        }], build_adjusted))

    bonferroni_cases = [case("alpha-" + str(alpha) + "-k" + str(k), [alpha, k], bonferroni)
                        for alpha, k in [(0.05, 1), (0.05, 2), (0.05, 3), (0.1, 4)]]
    bonferroni_cases.extend([
        error_case("k-zero", [0.05, 0], bonferroni),
        error_case("k-fractional", [0.05, 1.5], bonferroni),
        error_case("alpha-zero", [0.0, 2], bonferroni),
        error_case("alpha-one", [1.0, 2], bonferroni),
    ])

    return {
        "capping.resolvePercentileCap": {
            "module": "numpy", "symbol": "composed:§5.4", "cases": percentile_cases,
        },
        "capping.capValues": {
            "module": "python", "symbol": "composed:§5.4", "cases": cap_cases,
        },
        "capping.summarizeUnits": {
            "module": "python", "symbol": "composed:§6.3", "cases": unit_cases,
        },
        "capping.summarizeUnitsWithCovariate": {
            "module": "python", "symbol": "composed:§6.3", "cases": covariate_cases,
        },
        "capping.buildStatistic": {
            "module": "python", "symbol": "composed:§6.3", "cases": builder_cases,
        },
        "capping.buildRegressionAdjustedStatistic": {
            "module": "python", "symbol": "composed:§6.3", "cases": adjusted_cases,
        },
        "capping.bonferroniAlpha": {
            "module": "python", "symbol": "composed:§6.3", "cases": bonferroni_cases,
        },
    }
