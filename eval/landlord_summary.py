"""Pool the landlord-only runs of eval.demo_bundle_check (python -m eval.landlord_summary)."""
import json
from pathlib import Path

RES = Path(__file__).parent / "results"
for history in ("48", "full"):
    files = sorted(RES.glob(f"demo_bundle_check_seed*_history{history}_landlord.json"))
    if not files:
        continue
    print(f"history {history}: seeds {[json.loads(f.read_text())['seed'] for f in files]}")
    for w in ("24", "48"):
        tot = dict(hubs=0, active=0, flagged=0, hub_in_ring=0, adv_active=0, adv_flagged=0)
        for f in files:
            d = json.loads(f.read_text())["windows"][w]["hubs"]
            g = d["by_type"].get("landlord", {})
            tot["hubs"] += g.get("hubs", 0); tot["active"] += g.get("active", 0)
            tot["flagged"] += g.get("flagged", 0); tot["hub_in_ring"] += g.get("hub_in_ring", 0)
            a = d["by_adversarial"].get("True", {})
            tot["adv_active"] += a.get("active", 0); tot["adv_flagged"] += a.get("flagged", 0)
        print(f"  window {w} h: landlord hubs {tot['hubs']}, active {tot['active']}, scored >= threshold {tot['flagged']} "
              f"({tot['flagged'] / max(tot['active'], 1):.0%}), hub inside a detected ring {tot['hub_in_ring']} "
              f"({tot['hub_in_ring'] / max(tot['active'], 1):.0%}); adversarial active {tot['adv_active']}, flagged {tot['adv_flagged']}")
