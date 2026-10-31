from __future__ import annotations


def cases() -> dict:
    return {
        "example.identity": {
            "module": "example",
            "symbol": "identity",
            "cases": [
                {"name": "number", "input": {"args": [7]}, "expected": 7},
                {"name": "object", "input": {"args": [{"someValue": 2}]},
                 "expected": {"someValue": 2}},
            ],
        },
    }
