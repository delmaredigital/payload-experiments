"""MidExperimentPower at GrowthBook 0553a68; evaluated only on the fixture train."""
from __future__ import annotations

import importlib.util
from pathlib import Path
import sys

if "_gb" not in sys.modules:
    _spec = importlib.util.spec_from_file_location("_gb", Path(__file__).with_name("_gb.py"))
    _module = importlib.util.module_from_spec(_spec)
    sys.modules["_gb"] = _module
    _spec.loader.exec_module(_module)

from _gb import to_gb, moments_ts
from _common import raises


def cases() -> dict:
    from gbstats.bayesian.tests import EffectBayesianABTest, EffectBayesianConfig, GaussianPrior
    from gbstats.frequentist.tests import SequentialTwoSidedTTest, SequentialConfig
    from gbstats.models.tests import BaseConfig
    from gbstats.power.midexperimentpower import MidExperimentPower, MidExperimentPowerConfig

    def mean(n, average, variance):
        return {"type": "sampleMean", "n": n, "sum": n * average,
                "sumSquares": variance * (n - 1) + n * average ** 2}

    a = mean(1000, 2, 2)
    b = mean(1300, 2.2, 2.1)

    def build(x, y, config, power_config, bayesian=False):
        prior = power_config.get("priorEffect", {})
        prior = None if prior is None else GaussianPrior(**prior)
        kwargs = {"alpha": config.get("alpha", 0.05),
                  "difference_type": config.get("differenceType", "relative")}
        if bayesian:
            test = EffectBayesianABTest([(to_gb(x), to_gb(y))],
                                       EffectBayesianConfig(**kwargs, prior_effect=prior))
        else:
            test = SequentialTwoSidedTTest([(to_gb(x), to_gb(y))], SequentialConfig(**kwargs))
        res = test.compute_result()
        moments = test.moments_result
        args = [moments_ts(moments), {"errorMessage": res.errorMessage}, config, power_config]
        calculation = MidExperimentPower(moments, res, BaseConfig(**kwargs), MidExperimentPowerConfig(
            target_power=power_config.get("targetPower", 0.8),
            target_mde=power_config.get("targetMde", 0.01),
            num_goal_metrics=power_config.get("numGoalMetrics", 1),
            num_variations=power_config.get("numVariations", 2),
            prior_effect=prior, p_value_corrected=power_config.get("pValueCorrected", False),
            sequential=power_config.get("sequential", False),
            sequential_tuning_parameter=power_config.get("sequentialTuningParameter", 5000),
        ))
        return args, calculation

    def output_ts(res):
        return {"additionalUsers": res.additional_users, "scalingFactor": res.scaling_factor,
                "upperBoundAchieved": res.upper_bound_achieved, "updateMessage": res.update_message,
                "error": res.error, "targetPower": res.target_power}

    def row(name, x=a, y=b, config=None, power_config=None, bayesian=False):
        args, calculation = build(x, y, config or {}, power_config or {}, bayesian)
        return {"name": name, "input": {"args": args},
                "expected": output_ts(calculation.calculate_sample_size())}

    rows = [row("defaults-doubling-bisection"), row("already-powered", power_config={"targetMde": 10}),
            row("upper-bound-not-found", mean(1000, 2, 1e12), mean(1300, 2.2, 1e12),
                power_config={"targetMde": 1e-12, "priorEffect": None}),
            row("test-error-passthrough", mean(1000, 2, 0), mean(1300, 2.2, 0),
                power_config={"targetPower": 0.9}),
            row("proper-prior", power_config={"priorEffect": {"mean": 0, "variance": 0.09, "proper": True}},
                bayesian=True),
            row("proper-prior-ignores-sequential", power_config={"sequential": True,
                "priorEffect": {"mean": 0, "variance": 0.09, "proper": True}}, bayesian=True),
            row("corrected-3-variations-2-goals", power_config={"pValueCorrected": True,
                "numVariations": 3, "numGoalMetrics": 2, "priorEffect": None})]
    assert rows[0]["expected"]["scalingFactor"] > 1
    assert rows[1]["expected"]["additionalUsers"] is None
    assert rows[1]["expected"]["scalingFactor"] == 0
    assert rows[1]["expected"]["updateMessage"] == "successful"
    assert rows[2]["expected"]["error"] == "could not find upper bound for scaling factor"
    assert rows[3]["expected"]["additionalUsers"] == 0
    assert rows[3]["expected"]["error"]
    for difference in ("absolute", "relative"):
        for sequential in (False, True):
            for tuning in (5000, 1e6):
                for mde in (0.01, 0.05, -0.05):
                    rows.append(row(str((difference, sequential, tuning, mde)),
                                    config={"differenceType": difference}, power_config={
                                        "sequential": sequential, "sequentialTuningParameter": tuning,
                                        "targetMde": mde, "priorEffect": None}))

    # Small finite grid first; retain any upstream non-converging input as a
    # raises case. The final NaN target is a deterministic non-finite fallback:
    # every diff is NaN, so the 100-iteration tolerance check can never pass.
    found = False
    for target_power in (0.8, 0.999999, float("nan")):
        for mde in (0, 1e-12, 0.01):
            args, calculation = build(a, b, {}, {"targetPower": target_power, "targetMde": mde})
            try:
                calculation.calculate_sample_size()
            except ValueError:
                rows.append({"name": "non-convergence-grid", "input": {"args": args},
                             "expected": raises(ValueError, calculation.calculate_sample_size)})
                found = True
                break
        if found:
            break
    assert found, "expected NaN target to prevent bisection convergence"

    return {
        "midPower.midExperimentPower": {"module": "gbstats.power.midexperimentpower",
                                        "symbol": "MidExperimentPower", "cases": rows},
    }
