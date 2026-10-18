import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import ChatPanel from "./ChatPanel";
import { useSession } from "../auth/session";
import "./FloatingAssistant.css";

// The assistant, always one click away: a glowing orb in the corner that opens a chat panel. It uses the same
// chat as the Assistant page (same API, same checks on every answer), so it never invents data of its own.
// Only the roles that may use the assistant page get it.
export const ASSISTANT_ROLES = ["bank", "admin"];

export default function FloatingAssistant() {
  const session = useSession();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const orb = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") { setOpen(false); orb.current && orb.current.focus(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => { setOpen(false); }, [loc.pathname]);

  if (!session || !ASSISTANT_ROLES.includes(session.role) || loc.pathname.startsWith("/assistant")) return null;

  return (
    <div className="fa">
      {open ? (
        <section className="fa-panel" role="dialog" aria-label="Ask NEXUS Z">
          <header className="fa-head">
            <span className="fa-mini" aria-hidden="true" />
            <strong>Ask NEXUS Z</strong>
            <Link to="/assistant" className="fa-full">Open full page</Link>
            <button type="button" className="fa-close" aria-label="Close the assistant" onClick={() => { setOpen(false); orb.current && orb.current.focus(); }}>×</button>
          </header>
          <div className="fa-body"><ChatPanel compact /></div>
        </section>
      ) : null}
      <button ref={orb} type="button" className={`fa-orb${open ? " is-open" : ""}`} aria-label={open ? "Close the assistant" : "Ask NEXUS Z"} aria-expanded={open}
        onClick={() => setOpen((o) => !o)}>
        <span className="fa-blob b1" aria-hidden="true" />
        <span className="fa-blob b2" aria-hidden="true" />
        <span className="fa-blob b3" aria-hidden="true" />
        <span className="fa-glyph" aria-hidden="true">{open ? "×" : "✦"}</span>
      </button>
      {!open ? <span className="fa-hint" aria-hidden="true">Ask NEXUS Z</span> : null}
    </div>
  );
}
