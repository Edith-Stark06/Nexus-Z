import { useEffect, useId, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useData } from "../state/DataContext";
import { describeSystem } from "../lib/provenance";
import { formatUtc } from "../lib/constants";
import "./SystemStatus.css";

// The header control for "what am I looking at, and how much can I trust it". It keeps four facts apart (API, backend, source
// data, refresh) because a healthy API says nothing about how old the data behind it is.

function overall(sys, mode) {
  if (mode === "connecting" || mode === "standalone") return "none";
  if (sys.api.tone === "danger") return "danger";
  if (sys.api.tone === "warn" || sys.backend.tone === "warn") return "warn";
  if (sys.api.tone === "ok" && sys.backend.tone === "ok") return "ok";
  return "none";
}

export function StatusRows({ sys, headingLevel = 3 }) {
  const H = `h${headingLevel}`;
  const rows = [
    { key: "api", title: "API health", main: sys.api.label, tone: sys.api.tone, detail: sys.api.detail },
    { key: "backend", title: "Backend mode", main: sys.backend.label, tone: sys.backend.tone, detail: sys.backend.detail },
    { key: "source", title: "Source data", main: sys.source.label, tone: sys.source.tone, detail: sys.source.detail },
    { key: "refresh", title: "Last refresh", main: sys.refresh.label, tone: sys.refresh.tone, detail: sys.refresh.detail },
  ];
  return (
    <dl className="ss-rows">
      {rows.map((r) => (
        <div key={r.key} className="ss-row" data-row={r.key}>
          <dt>
            <H className="ss-title">{r.title}</H>
          </dt>
          <dd>
            <div className="ss-main">
              {r.tone !== "none" && <span className={`dot ${r.tone}`} aria-hidden="true" />}
              <span>{r.main}</span>
            </div>
            {r.detail && <div className="ss-detail">{r.detail}</div>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default function SystemStatus() {
  const data = useData();
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const id = useId();
  const sys = describeSystem(data);
  const tone = overall(sys, data.mode);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    const onDown = (e) => box.current && !box.current.contains(e.target) && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  if (data.mode === "standalone") return null;

  const asOf = sys.source.asOf ? formatUtc(sys.source.asOf) : null;
  return (
    <div className="ss" ref={box}>
      <button className="ss-btn" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <span className={`dot ${tone === "none" ? "" : tone}`} aria-hidden="true" />
        <span className="ss-label">{data.mode === "connecting" ? "Connecting…" : sys.backend.label === "Not known" ? sys.api.label : sys.backend.label}</span>
        {asOf && <span className="ss-asof">Data through {asOf.replace(" UTC", "")}</span>}
        <span className="sr-only">System status and data provenance</span>
      </button>
      {open && (
        <div id={id} className="ss-pop" role="dialog" aria-label="System status and data provenance">
          <div className="ss-head">
            <strong>System status</strong>
            <button className="ghost" onClick={data.refresh} title="Ask the API again now">
              <RefreshCw size={14} aria-hidden="true" /> Check now
            </button>
          </div>
          <StatusRows sys={sys} />
          <p className="ss-foot">
            A responding API does not mean the data is current. The source-data time is the newest payment the model has seen. Records returned here come from
            evaluation data documented as synthetic; they are not real customers' transactions.
          </p>
        </div>
      )}
    </div>
  );
}
