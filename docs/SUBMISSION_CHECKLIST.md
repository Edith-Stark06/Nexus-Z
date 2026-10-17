# Submission checklist: IBM Z Datathon 2026

Source: the Participant Guidebook. Times are India hub (IST) and region-specific, so confirm them in the Hack2Skill portal. Status as of Oct 17, 2026, 14:00 IST.

## Deadline

| When (IST) | What |
|---|---|
| Oct 17, 9:00 to 10:00 | Kick-off |
| Oct 17, 17:00 to Oct 18, 10:00 | Virtual continuation |
| **Oct 18, 10:00** | **End of the datathon: final submission** (confirm in the portal) |
| Oct 18, 10:30 | Closing ceremony |
| Oct 23 | Feedback survey |
| Oct 28 | Winners announced |

## What must be submitted (Hack2Skill: https://hack2skill.com/event/datathon-2026)

| Item | Requirement | Owner | Status |
|---|---|---|---|
| Demo video | **At most 3 minutes.** Problem, data supporting the problem, solution, and how it uses IBM Z: tech stack, **show the LinuxONE instance and the model** | Tushar (pitch), Ramana (ML segment) | Not started |
| Code | GitHub link | Ramana | Repo is public |
| Project title | Must contain the team name: `[Team Name_IBM Z Datathon 2026 Project]` | Ramana | **Team name unknown** |
| Open-source links | Links to every open-source resource used | Ramana | In `README.md`; re-check before submitting |
| Event code | Put `SSF2026` in the project description | Ramana | Not done |
| Flowchart (optional) | Design flowchart | Ramana | Mermaid diagram in `README.md`; team artifact exists |
| Prototype (optional) | Working prototype | Tushar (dashboard), Giridharan (API) | In progress |

## Before building (per the guidebook)

The two platform labs are described as mandatory before a team builds its own solution: **predictive AI hybrid (multi-model)** and **predictive AI plus generative AI**, both in `linuxone-community-cloud/jupyter-lab-ml` (notebooks include `Fraud_LSTM_Keras_TF`, `Churn_Scikit_PyTorch`, `Digit_Class_TensorFlow`, `Loan_Approval_Demo`). **Not done yet.** They run in the Jupyter Lab container already set up on the VM (`ml/LINUXONE.md`). Needs an owner and screenshots.

## Judging (10 points each, 40 total)

| Criterion | What we can show | Gap |
|---|---|---|
| Value to community and theme | Real-time fraud detection; protects scam victims; warning before the next payment | Frame it around people, not just the model |
| Novelty and originality | Ring-first detection, pass-through timing, explanations, victim warning | Pig-butchering results are on stand-in data only |
| Technical design and LinuxONE use (**screenshots as evidence**) | Training and scoring on the s390x VM in a Podman container; Jupyter on loopback with a token; same predictions as the laptop | Screenshots not taken yet. No accelerator is used, so claim none. Labs not done |
| Execution and pitch | Measured numbers, honest caveats | Video and demo not made. Dashboard not built |

Screenshots worth taking: the VM and its specs, `podman ps` with the container, `ss -ltn` showing Jupyter on `127.0.0.1` only, the training log (149 s on the VM), the test suite passing inside the container, the timing output (2.3 s rescore of 48 hours), a ring in the dashboard once it exists.

## Rules to keep in mind

- All code is to be created during the event window. Planning, research and the abstract before Oct 17 are fine. **Confirm with the organizers how pre-kickoff work counts** (owner: Ramana; Discord #helpdesk, or stemprograms@sstarsfoundation.org).
- Open-source libraries and public datasets are allowed with links and licenses. Elliptic is CC BY-NC-ND 4.0.
- No reuse of another team's code or ideas. No political or hateful content. Friendly competition only.

## Open questions

- Was the abstract (due Oct 15) submitted, and has the team been created on the Hack2Skill platform?
- Which track: an in-person hub (India) or virtual?
- Team name.
