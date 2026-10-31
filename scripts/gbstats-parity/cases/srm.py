from __future__ import annotations


def cases() -> dict:
    from gbstats.utils import check_srm

    inputs = [
        ("balanced-two", [500, 500], [50, 50]),
        ("balanced-three", [100, 100, 100], [1, 1, 1]),
        ("balanced-four", [100, 100, 100, 100], [25, 25, 25, 25]),
        ("balanced-five", [100, 100, 100, 100, 100], [20, 20, 20, 20, 20]),
        ("mild-two", [520, 480], [50, 50]),
        ("mild-three", [120, 90, 90], [1, 1, 1]),
        ("mild-four", [120, 110, 90, 80], [1, 1, 1, 1]),
        ("mild-five", [120, 110, 100, 90, 80], [1, 1, 1, 1, 1]),
        ("extreme-two", [980, 20], [50, 50]),
        ("extreme-three", [950, 25, 25], [1, 1, 1]),
        ("extreme-four", [850, 50, 50, 50], [1, 1, 1, 1]),
        ("extreme-five", [800, 50, 50, 50, 50], [1, 1, 1, 1, 1]),
        ("zero-total", [0, 0], [50, 50]),
        ("zero-weight-counted-dof", [100, 200, 0], [50, 50, 0]),
        ("holdout-balanced", [450, 450, 100], [45, 45, 10]),
        ("holdout-unnormalised", [480, 420, 100], [45, 45, 10]),
        ("holdout-fractions", [480, 420, 100], [0.45, 0.45, 0.1]),
    ]
    return {
        "srm.checkSrm": {
            "module": "gbstats.utils", "symbol": "check_srm",
            "cases": [
                {"name": name, "input": {"args": [users, weights]},
                 "expected": float(check_srm(users, weights))}
                for name, users, weights in inputs
            ],
        },
    }
