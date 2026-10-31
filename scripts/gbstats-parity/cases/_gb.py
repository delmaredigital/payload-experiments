"""Shared TS/gbstats converters. Importing this module needs no numerical deps."""
from __future__ import annotations

from dataclasses import asdict


def to_gb(ts_stat):
    from gbstats.models.statistics import (
        ProportionStatistic, SampleMeanStatistic, RegressionAdjustedStatistic,
    )

    kind = ts_stat["type"]
    if kind == "proportion":
        return ProportionStatistic(n=ts_stat["n"], sum=ts_stat["sum"])
    if kind == "sampleMean":
        return SampleMeanStatistic(n=ts_stat["n"], sum=ts_stat["sum"],
                                   sum_squares=ts_stat["sumSquares"])
    if kind == "regressionAdjusted":
        return RegressionAdjustedStatistic(
            n=ts_stat["n"], post_statistic=to_gb(ts_stat["post"]),
            pre_statistic=to_gb(ts_stat["pre"]),
            post_pre_sum_of_products=ts_stat["postPreSumOfProducts"],
            theta=ts_stat["theta"],
        )
    raise TypeError("unsupported statistic type: " + str(kind))


def from_gb(gb_stat):
    from gbstats.models.statistics import (
        ProportionStatistic, SampleMeanStatistic, RegressionAdjustedStatistic,
    )

    if isinstance(gb_stat, ProportionStatistic):
        return {"type": "proportion", "n": gb_stat.n, "sum": gb_stat.sum}
    if isinstance(gb_stat, SampleMeanStatistic):
        return {"type": "sampleMean", "n": gb_stat.n, "sum": gb_stat.sum,
                "sumSquares": gb_stat.sum_squares}
    if isinstance(gb_stat, RegressionAdjustedStatistic):
        return {"type": "regressionAdjusted", "n": gb_stat.n,
                "post": from_gb(gb_stat.post_statistic),
                "pre": from_gb(gb_stat.pre_statistic),
                "postPreSumOfProducts": gb_stat.post_pre_sum_of_products,
                "theta": gb_stat.theta}
    raise TypeError("unsupported gbstats statistic")


def moments_ts(result):
    return {"pointEstimate": result.point_estimate,
            "standardError": result.standard_error,
            "pairwiseSampleSize": result.pairwise_sample_size,
            "errorMessage": result.error_message}


def freq_ts(result):
    # Open ends remain numpy infinities for _common.encode's non-finite walker.
    return {"expected": result.expected, "ci": list(result.ci),
            "pValue": result.pValue, "uplift": asdict(result.uplift),
            "errorMessage": result.errorMessage,
            "pValueErrorMessage": result.pValueErrorMessage}
