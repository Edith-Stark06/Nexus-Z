"""Score the test window with a saved bundle and write real model outputs as API-shaped JSON.

Usage (from the repo root):  python -m ml.export_scores HI-Small [bundle folder] [output folder]
Every file is validated against api/schemas.py before it is written.
"""
import json
import sys
import time
from pathlib import Path

from api.schemas import AccountScore, Alert, Ring, RingSummary
from data.ibm_aml import load_transactions, primary_period, time_split
from data.paths import DATA_DIR

from .bundle import load_bundle
from .service import Scorer


def main(variant: str, bundle_dir: Path, out_dir: Path) -> None:
    bundle = load_bundle(bundle_dir)
    tx = primary_period(load_transactions(variant), variant)
    split = time_split(tx)
    since = tx.loc[split == "val", "ts"].max()  # accounts active in the test window

    t = time.time()
    scorer = Scorer.from_transactions(bundle, tx, active_since=since)
    print(f"features, scores and {len(scorer.rings)} rings in {time.time() - t:.0f}s "
          f"({len(scorer.X):,} accounts active in the window)")

    out_dir.mkdir(parents=True, exist_ok=True)

    def write(name, payload, schema, many=False):
        for item in payload if many else [payload]:
            schema(**item)
        (out_dir / name).write_text(json.dumps(payload, indent=2), encoding="utf-8")

    summaries = scorer.list_rings()
    write("rings.json", summaries, RingSummary, many=True)
    for s in summaries[:3]:
        write(f"ring_{s['ring_id']}.json", scorer.get_ring(s["ring_id"]), Ring)
    top = scorer.get_ring(summaries[0]["ring_id"])["members"][0]["id"]
    write(f"account_{top}.json", scorer.score_account(top), AccountScore)
    write("alerts.json", scorer.list_alerts(), Alert, many=True)
    print(f"wrote validated JSON to {out_dir}")
    for s in summaries[:5]:
        print(f"  {s['ring_id']}  risk {s['risk']:>3}  {s['accounts']:>2} accounts  {s['headline']}")


if __name__ == "__main__":
    v = sys.argv[1] if len(sys.argv) > 1 else "HI-Small"
    main(v, Path(sys.argv[2]) if len(sys.argv) > 2 else DATA_DIR / "models" / v,
         Path(sys.argv[3]) if len(sys.argv) > 3 else DATA_DIR / "exports" / v)
