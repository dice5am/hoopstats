"""Read data/marts/points_drivers.parquet (read-only) and write the slim JSON the
Insights points-drivers section renders: src/generated/points_drivers.json.

No number is invented here: every value is a parquet value, or a plain
difference/ratio of two parquet values (MAE improvement, cell counts).
Run:  python3 scripts/python/export_points_drivers_json.py
"""
import json
import math
import re
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "data" / "marts" / "points_drivers.parquet"
MANIFEST = ROOT / "data" / "marts" / "points_drivers_manifest.json"
OUT = ROOT / "src" / "generated" / "points_drivers.json"

PREGAME_SPEC = "@l10"  # doc: pre-declared primary pregame spec (inputs only)
MODELS = {"mixedlm": "mixedlm", "ols": "ols_cluster"}


def num(x):
    if x is None or (isinstance(x, float) and math.isnan(x)) or pd.isna(x):
        return None
    return float(x)


def note_val(notes, key):
    m = re.search(rf"{key}=([-0-9.eE]+)", notes or "")
    return float(m.group(1)) if m else None


def main():
    d = pd.read_parquet(SRC)
    manifest = json.loads(MANIFEST.read_text())
    d = d[~d.model.str.startswith("screen")]
    cells = {}
    for (lens, ts, seg), g in d.groupby(["lens", "timespan", "segment"]):
        suffix = PREGAME_SPEC if lens == "pregame" else ""
        thin = bool(g.thin_flag.iloc[0])
        n_players = int(g.n_players.iloc[0])
        n_games = int(g.n_games.iloc[0])
        cell = {"thin": thin, "n_players": n_players, "n_games": n_games, "fitted": True}
        if g.model.str.startswith("none").all():
            cell["fitted"] = False
            cell["models"] = {}
            cells.setdefault(lens, {}).setdefault(ts, {})[seg] = cell
            continue
        models = {}
        if not thin:
            for key, mname in MODELS.items():
                x = g[g.model == mname + suffix].dropna(subset=["rank_in_cell"])
                if x.empty:
                    continue
                x = x.sort_values("rank_in_cell")
                notes = x.notes.iloc[0]
                if key == "mixedlm" and "converged=True" not in notes:
                    continue  # only clean fits
                models[key] = {
                    "drivers": [
                        {
                            "driver": r.driver,
                            "coef": num(r.coef_std),
                            "lo": num(r.ci_low),
                            "hi": num(r.ci_high),
                            "rank": int(r.rank_in_cell),
                        }
                        for r in x.itertuples()
                    ],
                    "test_r2": num(x.test_r2.iloc[0]),
                    "test_mae": num(x.test_mae.iloc[0]),
                    "test_rmse": num(x.test_rmse.iloc[0]),
                    "baseline_mae": num(x.baseline_mae.iloc[0]),
                    "baseline_r2": note_val(notes, "baseline_r2"),
                }
        cell["models"] = models
        cells.setdefault(lens, {}).setdefault(ts, {})[seg] = cell

    # cell-count verdict for the pregame primary spec (non-thin cells)
    beats = {}
    for key, mname in MODELS.items():
        x = d[(d.lens == "pregame") & (d.model == mname + PREGAME_SPEC) & (~d.thin_flag)]
        c = x.groupby(["timespan", "segment"]).agg(mae=("test_mae", "first"), base=("baseline_mae", "first"))
        beats[key] = {"beat": int((c.mae < c.base).sum()), "cells": int(len(c))}

    out = {
        "through": manifest.get("through"),
        "pregame_spec": PREGAME_SPEC,
        "pregame_beats_baseline_mae": beats,
        "date_split": manifest.get("date_split", {}),
        "cells": cells,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, separators=(",", ":"), sort_keys=True) + "\n")
    print("wrote", OUT, OUT.stat().st_size, "bytes", beats)


if __name__ == "__main__":
    main()
