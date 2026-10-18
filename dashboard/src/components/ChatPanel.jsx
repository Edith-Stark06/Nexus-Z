import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { askAssistant, getChatStatus } from "../services/chat";
import { parseRich } from "../lib/richText";
import "./ChatPanel.css";
import InfoTip from "../components/InfoTip";

const SUGGESTIONS = ["Which rings are riskiest?", "Why was the top ring flagged?", "Who may pay in next?", "How current is the data?"];
const ID = /\b((?:RNG|ACC)-[0-9A-Za-z]{4,})\b/g;
const MAX = 500;

// Ring and account ids in an answer become links to their pages.
export function withLinks(text) {
  return String(text).split(ID).map((part, i) => {
    if (i % 2 === 0) return part;
    return <Link key={i} to={part.startsWith("RNG") ? `/ring/${part}` : `/account/${part}`}>{part}</Link>;
  });
}

// An answer from a hosted model: paragraphs, bold and lists, built as React elements (never as HTML), ids still links.
export function RichAnswer({ text }) {
  const parts = (pieces, keyBase) =>
    pieces.map((p, i) => {
      const key = `${keyBase}-${i}`;
      if (p.t === "bold") return <strong key={key}>{withLinks(p.v)}</strong>;
      if (p.t === "code") return <code key={key}>{p.v}</code>;
      return <span key={key}>{withLinks(p.v)}</span>;
    });
  return (
    <div className="chat-rich">
      {parseRich(text).map((b, i) => {
        if (b.type === "h") return <p key={i} className="chat-h">{parts(b.text, `h${i}`)}</p>;
        if (b.type === "ul") return <ul key={i}>{b.items.map((it, j) => <li key={j}>{parts(it, `u${i}${j}`)}</li>)}</ul>;
        if (b.type === "ol") return <ol key={i} start={b.start}>{b.items.map((it, j) => <li key={j}>{parts(it, `o${i}${j}`)}</li>)}</ol>;
        return (
          <p key={i}>
            {b.lines.map((line, j) => (
              <span key={j}>{j > 0 ? <br /> : null}{parts(line, `p${i}${j}`)}</span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

// Who actually hosts the model, taken from the address the API calls, so the page cannot claim a provider it is not using.
export function providerName(url) {
  try {
    const host = new URL(url).hostname;
    if (host.endsWith("huggingface.co")) return "Hugging Face";
    if (host.endsWith(".cloud.ibm.com")) return "IBM watsonx.ai";
    if (host === "integrate.api.nvidia.com" || host.endsWith(".nvidia.com")) return "NVIDIA NIM";
    return host;
  } catch {
    return "an external provider";
  }
}

// What to call the model that is answering: Granite only when the model really is a Granite model.
export function modelLabel(model) {
  if (!model) return "Language model";
  return /granite/i.test(model) ? "IBM Granite" : model;
}

function Badge({ status }) {
  if (!status) return <span className="chat-badge chat-badge-off">API unreachable</span>;
  if (status.mode === "llm") return <span className="chat-badge chat-badge-llm">{modelLabel(status.models && status.models[0])} · {providerName(status.provider)}</span>;
  if (status.mode === "local") return <span className="chat-badge chat-badge-llm">IBM Granite Embedding · on this machine</span>;
  return <span className="chat-badge chat-badge-rules">Built-in rules, no language model</span>;
}

function Meta({ m }) {
  if (!m) return null;
  const who =
    m.mode === "llm"
      ? `Answered by ${m.model} through ${providerName(m.provider)}`
      : m.mode === "local"
        ? `Question understood by ${m.model} on this machine; the answer is a fixed sentence filled from our data`
        : "Answered by the built-in rules";
  return (
    <div className="chat-meta">
      <span>
        {who} in {m.seconds} s.
      </span>
      {m.note && <span className="chat-note"> {m.note}</span>}
      {m.warnings?.map((w) => (
        <div key={w} className="chat-warning" role="note">
          {w} Check them against the ring page.
        </div>
      ))}
      {m.tools_used?.length > 0 && (
        <details>
          <summary>Where this came from ({m.tools_used.length})</summary>
          <ul>
            {m.tools_used.map((t, i) => (
              <li key={i}>
                {t.tool}
                {Object.keys(t.args || {}).length ? ` ${JSON.stringify(t.args)}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

// What the person is waiting for: a hosted model can take up to half a minute, the other modes answer at once.
function Waiting({ status, seconds }) {
  const hosted = status && status.mode === "llm";
  return (
    <div className="chat-msg chat-assistant">
      <div className="chat-bubble chat-pending" role="status" aria-live="polite">
        <span className="chat-dots" aria-hidden="true"><i /><i /><i /></span>
        <span>
          {hosted
            ? `Asking the model, this can take up to 30 seconds (${seconds} s so far)`
            : "Looking at the data…"}
        </span>
      </div>
    </div>
  );
}

export default function ChatPanel({ compact = false }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [waited, setWaited] = useState(0);
  const [status, setStatus] = useState(undefined);
  const end = useRef(null);

  useEffect(() => {
    let stopped = false;
    getChatStatus().then((s) => !stopped && setStatus(s));
    return () => {
      stopped = true;
    };
  }, []);

  useEffect(() => {
    end.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
  }, [messages, pending]);

  useEffect(() => {
    if (!pending) { setWaited(0); return undefined; }
    const id = setInterval(() => setWaited((w) => w + 1), 1000);
    return () => clearInterval(id);
  }, [pending]);

  async function send(text) {
    const question = text.trim();
    if (!question || pending) return;
    const history = messages.filter((m) => !m.error).map(({ role, content }) => ({ role, content }));
    setMessages((m) => [...m, { role: "user", content: question }]);
    setInput("");
    setPending(true);
    try {
      const a = await askAssistant(question, history);
      setMessages((m) => [...m, { role: "assistant", content: a.answer, meta: a }]);
      getChatStatus().then(setStatus);
    } catch (err) {
      setMessages((m) => [...m, { role: "assistant", content: err.message, error: true }]);
      setInput((current) => current || question); // a failed question is never lost: it goes back in the box
    } finally {
      setPending(false);
    }
  }

  return (
    <section className={`chat${compact ? " chat-compact" : ""}`} aria-label="Assistant" aria-busy={pending}>
      <header className="chat-head">
        {compact ? null : <h2 className="sr-only">Ask NEXUS Z</h2>}
        {status !== undefined && <Badge status={status} />}
        {compact ? <InfoTip k="chat" /> : null}
      </header>
      <p className="chat-disclaimer">
        Synthetic data. Answers come only from NEXUS Z's own data; roles are estimates and "flagged" does not mean guilty.
        {status?.mode === "llm" &&
          ` The language model runs at ${providerName(status.provider)}, not on the LinuxONE VM: your question and compact synthetic ring facts are sent there.`}
        {status?.mode === "local" &&
          " IBM Granite Embedding runs on the same machine as the API and only chooses which question this is; it writes no text. Nothing leaves the machine."}
      </p>

      <div className="chat-log" role="log" aria-live="polite">
        {messages.length === 0 && (
          <div className="chat-empty">
            Try one of these:
            <div className="chat-suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => send(s)} disabled={pending}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg chat-${m.role}${m.error ? " chat-error" : ""}`}>
            <div className="chat-bubble" role={m.error ? "alert" : undefined}>
              {m.role === "assistant" && !m.error && m.meta?.mode === "llm" ? <RichAnswer text={m.content} /> : m.role === "assistant" ? withLinks(m.content) : m.content}
            </div>
            <Meta m={m.meta} />
          </div>
        ))}
        {pending && <Waiting status={status} seconds={waited} />}
        <div ref={end} />
      </div>

      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <textarea
          value={input}
          maxLength={MAX}
          rows={2}
          autoFocus={compact}
          placeholder="Ask about a ring, an account or the alerts"
          aria-label="Your question"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
        />
        <div className="chat-form-foot">
          <span>
            {input.length}/{MAX}
          </span>
          <button type="submit" disabled={pending || !input.trim()}>
            {pending ? "Waiting…" : "Ask"}
          </button>
        </div>
      </form>
    </section>
  );
}
