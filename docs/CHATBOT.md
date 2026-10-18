# The AI-assisted chat (IBM Granite)

An analyst can ask NEXUS Z questions in plain language ("Which rings are riskiest?", "Why was the top ring flagged?", "Who may pay in next?") on the **Assistant** page of the dashboard or with `POST /chat`. Every fact in an answer comes from our own API through read-only tools. The assistant explains what the detection model found. It does not detect anything.

There are three ways a question is answered, tried in this order, and every answer says which one it used (`mode` in the response, shown under the answer):

| `mode` | Who does what | Needs | Runs on the VM? |
|---|---|---|---|
| `llm` | A hosted **IBM Granite** writes the answer after calling the tools; the answer is checked. Either **IBM watsonx.ai** (`ibm/granite-4-h-small`) or **Hugging Face** (Granite 4.2 30B, 8B, 3B) | an IBM Cloud API key + a watsonx.ai project id, **or** a Hugging Face token **with credits** | **No**, hosted by IBM or by Hugging Face / DeepInfra |
| `local` | **IBM Granite Embedding 30M** decides which question this is; the answer is a fixed sentence filled from the API | nothing (free; 60 MB of weights on the VM) | **Yes**, in the API container, on the CPU |
| `rules` | Plain keywords decide which question this is; same fixed sentences | nothing | Yes |

**What we ship and demonstrate is `local`**: it is free, it needs no token, nothing leaves the machine, and it is measured below. The hosted `llm` mode (watsonx.ai or Hugging Face) is built and unit-tested but has never produced an answer: the Hugging Face account we have is a free one with no credits (HTTP 402), and no watsonx.ai credentials have been used yet (see "What was tested"). In `local` mode Granite **understands** the question; it writes no text, so it cannot invent a fact. The worst it can do is pick the wrong topic.

## Why Granite understands but does not write, on the VM

We tried the obvious thing first: run a small Granite model on the VM's 3 CPUs and let it write the answers (`docs/ML_RESULTS.md` section 8 and the numbers here, all measured on this VM with llama.cpp, big-endian GGUF, 4-bit):

| Model | Speed | Result |
|---|---|---|
| Granite 4.0 350M | 2 s per short question | attached numbers to the wrong facts ("two likely victims" for a ring with one) |
| Granite 4.0 H 1B | prompt 12 tokens/s, writing 2.2 tokens/s | wrong facts in the answer |
| Granite 4.2 3B | prompt 5 tokens/s, writing 0.9 tokens/s; 333 s for one answer | rambling reasoning, far too slow |
| Qwen2.5 1.5B Instruct (not Granite; Apache 2.0, 4-bit, tried because it is a stronger open model) | 160 to 195 prompt tokens, 11 to 117 new tokens: 15 s, 28 s and 70 s on the idle VM | 1 of 3 answers right: it named one of three tied rings with a mangled id ("RING-50C67B"), and ran past the three-sentence limit on the second question; the third answer was right |
| Granite 4.2 30B | does not fit: 58.6 GB of weights, the VM has 7.5 GB of RAM | not possible |

We also tried making the small models only **pick a letter** for the intent of the question (grammar-constrained, 48 questions): 350M got 17%, 1B got 40%, and the keyword rules got 71%. So a small generative model is not good enough here, in either role.

A Granite **embedding** model is a different tool: it turns a text into a vector and takes about 10 ms. We give it a few example questions for each of five topics (`EXAMPLES` in `api/intent.py`), embed the analyst's question, and the closest example decides the topic. If nothing is similar enough (cosine similarity below 0.65), the answer is the help text. That is the whole use of the model.

## What the local mode measured

Model: `ibm-granite/granite-embedding-30m-english` (Apache 2.0, 30.3M parameters, 60.6 MB, revision pinned in `infra/prepare_granite_embedding.sh`), on the VM's CPU through PyTorch. Reproduce: `python -m api.intent_eval` (on the VM: `/opt/venv/bin/python -m api.intent_eval`).

| Question set | Questions | Keyword rules | Granite Embedding |
|---|---|---|---|
| Development (used to choose the threshold 0.65) | 47 | 33 = 70% | 41 = **87%** |
| Held-out | 36 | 17 = 47% | 30 = 83% |
| **Fresh** (written last, run once, nothing changed afterwards) | 31 | 11 = 35% | 27 = **87%** |

Quote the **fresh** row. The held-out set is not clean: its misses led us to add some examples (three were copied word for word and those three questions were removed from the sets; a few more examples are close paraphrases), so it flatters the model. The questions were written by us, in English, about five topics (the riskiest rings, why the top ring was flagged, likely victims, alerts, data freshness) plus off-topic questions; they are not real analysts' questions, so the true accuracy on analysts will differ. The fresh set's four misses: "what are the scariest groups of accounts right now" (read as victims), "are there people we need to protect" (read as top rings), "anything new I should know about" (read as status), "is the API up" (found no topic). The threshold matters: on the first version of the held-out set (38 questions) 0.60 gave 28 right, 0.65 gave 32 and 0.70 gave 28, so 0.65 is tuned, not a law.

Live on the VM, in the API container (3 vCPUs shared with the rebuilds): the model loads in about 8 s in the background when the API starts; a question then takes 10 to 20 ms for the understanding (the whole answer, tools included, was 0.01 to 0.02 s). The container used 1.19 GB of its 5 GB limit in total. A question that names an id (`RNG-3E0A24`, `ACC-0016AB`) needs no topic and is answered directly.

What the model can get wrong is the topic, never a fact: it cannot add text, so the figures and ids always come from the tools. A wrong topic gives a correct answer to a different question, and the page shows what was asked of the data under "Where this came from" and the similarity in the note.

## How the layers fit

| Part | Where | Notes |
|---|---|---|
| Detection, scoring, rings, reasons, the data | LinuxONE VM | unchanged by the assistant |
| The five tools, the rules answers, the topic router (Granite Embedding), the checks, the token | LinuxONE VM (the API container) | `api/chat.py`, `api/intent.py` |
| IBM Granite Embedding weights | the VM, `~/data/granite-embedding-30m-english`, mounted read-only, offline | `bash infra/prepare_granite_embedding.sh` downloads them once |
| The hosted Granite 4.2 (optional) | Hugging Face Inference Providers, served by DeepInfra | **not on the VM** |

We do not claim the assistant uses the LinuxONE accelerator (we did not measure it for this model), or that a language model that writes text runs on the VM. In a bank the larger models would run on premises, for example on IBM Z; this demo uses a hosted endpoint for them only because the VM cannot hold them.

**What leaves the VM in `local` and `rules` mode: nothing.** In `llm` mode: the instruction text (the rules in `api/chat.py`), the question (at most 500 characters), up to the last six turns, and the tool results the model asks for (synthetic ring and account ids, estimated roles, risk scores, reasons, times and counts, at most 6,000 characters per result). Never the transactions, the model files, the dataset or the token. The data is synthetic; with real data this design would need a data-protection review first.

## The hosted mode on IBM watsonx.ai (optional, needs an IBM Cloud account)

If an IBM Cloud API key, a region URL and a watsonx.ai project id are all configured, hosted questions go to watsonx.ai instead of Hugging Face (nothing else changes: same five tools, same checks, same fallbacks).

- **Model.** `ibm/granite-4-h-small` (32B, Granite 4.0 H Small, 131,072-token context). We read watsonx.ai's public model list on 2026-10-18: in `eu-de` and `us-south` it was the only chat Granite, with `text_chat` and `function_calling`, lifecycle "available" since 2025-10-02. (Other chat models there with the same filter: `meta-llama/llama-3-3-70b-instruct`, `meta-llama/llama-4-maverick-17b-128e-instruct-fp8`, `mistralai/mistral-medium-2505`, `mistralai/mistral-small-3-1-24b-instruct-2503`; none is used unless you set `NEXUSZ_WATSONX_MODELS`.) Other regions listed no chat Granite.
- **How it is called.** The API key is exchanged at `https://iam.cloud.ibm.com/identity/token` for a short-lived bearer token (cached, renewed two minutes before it expires), then `POST {region url}/ml/v1/text/chat?version=2024-10-08` with `model_id`, `project_id`, `messages`, `tools` and `tool_choice_option: auto`, following IBM's tool-calling documentation. From a container on the VM we confirmed that both `iam.cloud.ibm.com` and `eu-de.ml.cloud.ibm.com` answer HTTP 200 on their public endpoints.
- **Set up** (on the VM, in your own terminal): create an API key at cloud.ibm.com/iam/apikeys, create or open a watsonx.ai project and note its id, then `bash infra/set_watsonx_key.sh` (hidden prompt, podman secret `nexusz_watsonx_key`), then
  `NEXUSZ_WATSONX_URL=https://eu-de.ml.cloud.ibm.com NEXUSZ_WATSONX_PROJECT_ID=<project id> bash infra/podman_api.sh stop && NEXUSZ_WATSONX_URL=... NEXUSZ_WATSONX_PROJECT_ID=... bash infra/podman_api.sh start`, then `bash infra/podman_api.sh check` (it prints "watsonx key secret: stored"; the chat status shows `"mode":"llm"` and the region URL). The region of the URL must be the one where the project lives. The key and the bearer token are never logged, returned or put in an environment variable.
- **Not verified.** Everything above that talks to the paid or free watsonx.ai service is written from IBM's documentation and exercised only against a scripted fake (12 tests in `api/tests/test_watsonx.py`). We have **not** made one authenticated call: we do not know whether a free (Lite) plan includes this model, what its quota is, or whether the request fields are accepted exactly as written. If the first real call fails, the assistant says why in `note` and answers in `local` mode.

## The hosted mode on Hugging Face (optional, needs credits)

- `ibm-granite/granite-4.2-30b`: Apache 2.0, not gated, a reasoning model with tool calling, 131,072-token context ([model page](https://huggingface.co/ibm-granite/granite-4.2-30b)). Hugging Face lists one live provider for it, DeepInfra, at $0.16 per million input tokens and $0.65 per million output tokens (the provider's numbers, not ours).
- **DeepInfra's page for this model says: "Due to low usage this model will be deprecated on 10/18/2026."** That is the submission day. The same provider also lists `granite-4.2-8b` and `granite-4.2-3b` as live (we did not check their retirement dates). The assistant tries 30B, then 8B, then 3B, then the local mode. Change the order with `NEXUSZ_CHAT_MODELS`.
- How an answer is made: the question and the last turns go to the model with an instruction (answer only from tool results, never invent ids, numbers, dates or roles, say "flagged" and never "guilty"); the model may call `list_rings`, `get_ring`, `get_account`, `list_alerts` and `system_status` (arguments are checked, results capped, at most four rounds); the reasoning text is removed; then **the checks**: the answer is rejected, and the next model (finally the local mode) answers, if it names an id that no tool returned, uses an accusing word, or is empty; a number that appears in no tool result is listed as a warning under the answer.
- **What the checks do not catch.** They cannot tell whether a correct number is attached to the right fact (Granite 350M wrote "Two likely victims" for a ring with one and passed a check that only asked whether the number existed). That is one reason the shipped mode does not let a model write.
- **The token.** It needs a Hugging Face access token with the permission "Make calls to Inference Providers" **and credits on the account**. It is stored as a **podman secret** (`bash infra/set_chat_token.sh`, hidden prompt; `--remove` forgets it), mounted into the API container as a read-only file for the container user, so it is not in the repository, a command line, an environment variable or `podman inspect`. The code never logs it, returns it, or leaves it in error text. **Never paste a token into a chat or a file in the repository.** For a laptop run, `HF_TOKEN=hf_... uvicorn api.main:app` works too.

Settings (all optional): `NEXUSZ_CHAT=off` switches every model off (keywords only), `NEXUSZ_CHAT_INTENT_MODEL` (folder or Hugging Face name of Granite Embedding; `infra/podman_api.sh` sets it when `~/data/granite-embedding-30m-english` exists, `NEXUSZ_CHAT_INTENT=off` skips it), `NEXUSZ_CHAT_MODELS`, `NEXUSZ_CHAT_BASE_URL`, `NEXUSZ_WATSONX_URL`, `NEXUSZ_WATSONX_PROJECT_ID`, `NEXUSZ_WATSONX_MODELS`, `NEXUSZ_WATSONX_KEY_FILE` (default `/run/secrets/nexusz_watsonx_key`; `WATSONX_APIKEY` also works), `NEXUSZ_CHAT_MAX_TOKENS` (1,200), `NEXUSZ_CHAT_TIMEOUT` (60 s per call), `NEXUSZ_CHAT_RATE_PER_MIN` (12, then HTTP 429), `NEXUSZ_CHAT_REASONING_EFFORT` (low; retried without it if the provider refuses the parameter).

To set up the local mode on a fresh VM: `bash infra/prepare_granite_embedding.sh`, then `bash infra/podman_api.sh stop && bash infra/podman_api.sh start`, then `bash infra/podman_api.sh check` (it prints "Granite Embedding: ... mounted read-only, offline" and the chat status `"mode":"local"`). Without the downloaded folder the assistant uses keywords and says so.

## What was tested, and what was not

| Check | Result |
|---|---|
| 38 tests of the hosted path and the rules (`api/tests/test_chat.py`) against a scripted fake of the provider | pass: tool loop, thinking removed, unknown id rejected, accusing word rejected, unmatched number warned, retired model falls back, 401/402/403 stop at once and the token never appears in a response or the logs, timeouts, rate limit, input validation, the rules answers |
| 24 unit tests of the local path (`api/tests/test_intent.py`), one skipped without the model | pass: every topic has an answer, nothing close enough gives the help text and keywords do not overrule it, an id in the question skips the router, a model that cannot load gives keywords and says why, hosted first and local after a failure, status and endpoints, no example question is also a test question |
| Granite Embedding for real, on the VM (`python -m api.intent_eval`) | table above |
| 12 dashboard tests (`dashboard/src/__tests__/assistant.test.jsx`) | pass: provider named from its real address, local mode says the model only chose the question and nothing leaves the machine, rules mode stated plainly, history never includes an error, no sample data on failure |
| The real API container on the VM, local mode, seven questions through `POST /chat` | the right topic and answer for the five paraphrases tried ("which clusters carry the most risk", "why is the number one ring considered suspicious", "who is likely to be cheated next", "have any alarms gone off", "how long ago was the system updated"), the help text for "tell me a joke", and the direct answer for "Explain RNG-FFFF" (no such ring) |
| watsonx.ai path, 12 tests (`api/tests/test_watsonx.py`) against a scripted fake of IAM and the chat endpoint | pass: sign-in with the key, bearer token reuse, request fields, model fall-through, 401/402/403 stop at once, rejected key, the same answer checks, key and token never in a response or log |
| watsonx.ai public model list and sign-in address, read from the laptop and from a container on the VM | reachable (HTTP 200); `ibm/granite-4-h-small` listed with chat and function calling in `eu-de` and `us-south`. **No authenticated call made** |
| Hosted mode: an unauthenticated call, from the laptop and from a container on the VM | HTTP 401 from both: the endpoint exists and the VM can reach it |
| **Hosted mode: an authenticated call to Granite** (2026-10-18, on the VM) | **reached the provider, but no answer was produced.** The token was valid with the right scope, and Hugging Face answered HTTP 402: "You have no remaining credits. Purchase pre-paid credits to continue using Inference Providers." The account is a free one. The assistant behaved as designed: it stopped at once, answered without a hosted model, and said why. **So nothing here shows how the hosted Granite phrases answers, how long they take or what they cost**; our estimate of about $0.001 per question is an estimate. The token used for this test was pasted into a chat, so it must be treated as exposed: it was removed from the VM and has to be revoked at huggingface.co/settings/tokens |
| Not done | a browser run of the final Assistant page against the VM (a headless browser would not start here; the page is covered by the dashboard tests and the served files were checked to contain the new text); an accelerator (NNPA) measurement for the embedding model |

## Limits

- It answers about the rings, accounts, alerts and data freshness in the running system. It does not know the ML results or the documentation, and does not explain the model beyond the reasons attached to a ring or account.
- `local` and `rules` answers are fixed sentences: they list, they do not converse, and they do not remember earlier turns. Only the hosted mode takes the conversation into account.
- The topic router knows five topics and English. A question it does not recognise gets the help text; a question it mistakes for another topic gets a correct answer to that other topic (87% right on the fresh set, so about one in eight).
- Ring ids can change when a ring is rebuilt; a question about an id that no longer exists gets that answer.
- The hosted 30B endpoint may disappear (see above); the 8B and 3B answer less well. We have not compared them.
- There is no login. The API listens on the VM's loopback and is reached through the SSH tunnel; the rate limit is global, not per user, and exists to stop a runaway page, not a determined user.

## What to say in the demo

Say: "The assistant uses IBM Granite Embedding, running on the LinuxONE VM, to understand the question; the answer is a fixed sentence filled with facts from our own API, so it cannot invent a figure. It does not detect anything, and nothing leaves the machine." Do not say: that a language model writes the answers on the VM, that Granite uses the accelerator, that it understands every question (about 87% of ours), or that the hosted 30B was used. If the page shows "Built-in rules", say so.
