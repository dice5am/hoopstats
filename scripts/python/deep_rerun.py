"""Re-run selected cells (default: cells whose log contains 'failed') and patch the cached results; per-cell caches in data/cache/cells/."""
import sys, time, pickle, warnings
from multiprocessing import Pool
from pathlib import Path
import numpy as np, pandas as pd
sys.path.insert(0, str(Path(__file__).resolve().parent))
import deep_analyses as A
import deep_data as DD
warnings.filterwarnings("ignore")
CACHE = A.ROOT / "data" / "cache"; (CACHE / "cells").mkdir(parents=True, exist_ok=True)


def work(task):
    out, dt = A.run_cell(task); pd.to_pickle(out, CACHE / "cells" / f"{task[0]}__{task[1]}.pkl"); return task, out, dt


if __name__ == "__main__":
    res = pd.read_pickle(CACHE / "deep_cell_results.pkl")
    d = DD.build("2026-11-09"); A.WM, A.G_ALL, A.FLOORS, A.CUTS = d["WM"], d["G"], d["floors"], d["CUTS"]; A.WM["prog_log"] = np.log(A.WM.n_prior_season.astype(float))
    todo = [k[1] for k, v in res.items() if k[0] == "cell" and any("failed" in n for n in v["log"]["notes"])]
    print("rerun", todo, flush=True)
    with Pool(8) as pool:
        for task, out, dt in pool.imap_unordered(work, todo):
            res[("cell", task)] = out; print("done", task, f"{dt:.0f}s", out["log"]["notes"], flush=True)
    pd.to_pickle(res, CACHE / "deep_cell_results.pkl"); pd.to_pickle(res, "/tmp/deep_results.pkl")
