# Demo video script, draft (3 minutes at most)

Written by Ramana as a complete fallback so the video is never blocked. Giridharan or Tushar can edit it or replace it with `docs/VIDEO_SCRIPT.md`. The guidebook asks for: the problem, the data, the solution, how it uses IBM Z (stack), and **showing the LinuxONE instance and the model**. Speaking time is about 150 words a minute; the narration below is about 300 words, paced row by row (the VM and replay rows have silent screen time on purpose).

**Before recording:** follow `docs/DEMO.md` (API container on the VM, SSH tunnel, `npm run dev`, badge says LIVE API). The VM must be idle. Record the dashboard and one terminal on the VM side by side. Do the take after Tushar's dashboard PR is merged. Do not click anything that is not in this script.

| Time | On screen | Narration (who) | Source of every number |
|---|---|---|---|
| 0:00 to 0:25 | Dashboard home, ring list | **(Tushar)** "Pig-butchering scams groom victims online, then move their money through collector and mule accounts to a cash-out, often within minutes. Each payment looks ordinary, so banks that score payments one at a time miss the ring. NEXUS Z finds the whole ring from the flow of payments, explains why, and flags who may pay in next." | none |
| 0:25 to 0:55 | Slide or the README architecture diagram | **(Ramana)** "The data is IBM's synthetic anti-money-laundering transactions, plus pig-butchering rings that our own team simulated. Everything you will see is synthetic. A payment-level XGBoost model scores every payment from its amount, timing and how fast money moves on, plus graph features of both accounts. An account's risk is its riskiest payment, and linked high-risk accounts form rings." | README, `ml/` docs |
| 0:55 to 1:30 | VM terminal: `podman ps`, then `bash infra/podman_api.sh check` | **(Ramana)** "This is the LinuxONE VM. The model runs in a rootless Podman container: loopback only, non-root, read-only filesystem, every capability dropped, memory limit. It was trained here, in the platform's container, in about fifteen minutes." | `docs/PLATFORM_RESULTS.md` 3c; `docs/TECHNICAL_DESIGN.md` |
| 1:30 to 1:55 | Start `infra.simulator replay --speed 600`; the ring list changes | **(Ramana)** "Now payments stream in. The API rebuilds in the background, and a new payment shows up in about ten seconds." | `docs/PLATFORM_RESULTS.md` 3c: 9.6 to 9.9 s |
| 1:55 to 2:25 | Open the top ring: graph, case summary, why flagged; then Alerts, Preview | **(Tushar)** "Open a ring. The graph shows who paid whom, with estimated roles. The reasons come from exact TreeSHAP values, and say when a signal is absent. The case summary is a template of facts, not generated text. From the alerts we open the pre-payment warning for the account that was paid." | dashboard; `ml/explain.py`, `ml/narrative.py` |
| 2:25 to 2:50 | Slide: three numbers and one honest line | **(Ramana)** "On IBM's data the payment model scores 0.45 against 0.15 for an account-level model. On simulated rings it never saw, the demo model recovers 84 percent in the last day. Detection is trees on the CPU. We counted the accelerator with hardware counters: a network used it, trees did not, but the network was worse, so we did not ship it." | `docs/ML_RESULTS.md` sections 6, 7, 8 |
| 2:50 to 3:00 | Dashboard home | **(Tushar)** "Accuracy is modest and the data is synthetic, and we say so. NEXUS Z, built on IBM LinuxONE." | none |

## Notes for the person recording

- Say **"synthetic"** at least twice. Say **"estimated roles"** once. Say **"about ten seconds"**, never "instant" or "real time".
- Do not say that detection runs on the accelerator, that warnings were sent, or that any account is a criminal.
- If the replay is too fast to narrate, use `--speed 300`. If the dashboard shows "sample data" instead of LIVE API, stop and fix the tunnel before recording.
- The numbers 0.45 and 0.15 are one seed for the committed 57-feature model (`docs/ML_RESULTS.md` section 6). The 84 percent is pooled over four unseen random draws of simulated rings (36 of 43 rings, last 24 hours, `docs/ML_RESULTS.md` section 7).
- Upload limits and format: check the Hack2Skill form for a file size or a link field before exporting.
