from __future__ import annotations


def cases() -> dict:
    from scipy.stats import chi2, norm, t

    positive_z = [1e-8, 1, 1.96, 3, 5, 8.3, 10, 20, 30, 37.5, 38]
    zs = [-x for x in reversed(positive_z)] + [0] + positive_z
    probabilities = [
        1e-300, 1e-200, 1e-100, 1e-50, 1e-16, 1e-10, 1e-5,
        0.001, 0.025, 0.05, 0.1, 0.3, 0.5, 0.7, 0.9, 0.95,
        0.975, 0.999, 1 - 1e-5, 1 - 1e-10, 1 - 1e-16,
    ]
    degrees = [1, 1.5, 2, 2.5, 3, 5, 10.7, 30, 100, 1e4, 1e6, 1e7]
    xs = [-50, -10, -3, -1, 0, 0.5, 2, 6, 40]
    t_ps = [1e-12, 1e-6, 0.025, 0.5, 0.975, 1 - 1e-6, 1 - 1e-12]
    chi_xs = [0, 1e-6, 0.5, 1, 3.84, 10, 50, 200, 600, 1000]

    def unary(fn, values):
        return [
            {"name": str(i) + ":" + str(x), "input": {"args": [x]},
             "expected": float(fn(x))}
            for i, x in enumerate(values)
        ]

    def binary(fn, values, dfs):
        return [
            {"name": str(n) + ":" + str(i) + ":" + str(x),
             "input": {"args": [x, n]}, "expected": float(fn(x, n))}
            for n in dfs for i, x in enumerate(values)
        ]

    return {
        "distributions.normalCdf": {
            "module": "scipy.stats", "symbol": "norm.cdf",
            "cases": unary(norm.cdf, zs),
        },
        "distributions.normalSf": {
            "module": "scipy.stats", "symbol": "norm.sf",
            "cases": unary(norm.sf, zs),
        },
        "distributions.normalPpf": {
            "module": "scipy.stats", "symbol": "norm.ppf",
            "cases": unary(norm.ppf, probabilities),
        },
        "distributions.tCdf": {
            "module": "scipy.stats", "symbol": "t.cdf",
            "cases": binary(t.cdf, xs, degrees),
        },
        "distributions.tPpf": {
            "module": "scipy.stats", "symbol": "t.ppf",
            "cases": binary(t.ppf, t_ps, degrees),
        },
        "distributions.chi2Sf": {
            "module": "scipy.stats", "symbol": "chi2.sf",
            "cases": binary(chi2.sf, chi_xs, [1, 2, 3, 4]),
        },
    }
