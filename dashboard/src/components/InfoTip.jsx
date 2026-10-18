import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { HELP } from "../lib/help";
import "./InfoTip.css";

/**
 * A small "i" that explains a feature. It opens on hover, on keyboard focus and on tap or click, closes on Escape
 * or when you click elsewhere, and the text is read out by screen readers (role tooltip, described-by).
 *   <InfoTip k="flowGraph" />                     text from lib/help.js
 *   <InfoTip title="..." text="..." />            text given directly
 */
export default function InfoTip({ k, title, text }) {
  const entry = k ? HELP[k] : { title, text };
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0);
  const id = useId();
  const wrap = useRef(null);
  const pop = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    const onDown = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onDown); };
  }, [open]);

  // keep the card on screen: slide it back if it would run off either side
  useLayoutEffect(() => {
    if (!open || !pop.current) { setShift(0); return; }
    const box = pop.current.getBoundingClientRect();
    const margin = 10;
    const over = box.right - (window.innerWidth - margin);
    const under = margin - box.left;
    setShift(over > 0 ? -over : under > 0 ? under : 0);
  }, [open]);

  if (!entry) return null;
  return (
    <span className="info" ref={wrap} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" className="info-btn" aria-label={`About: ${entry.title}`} aria-expanded={open} aria-describedby={open ? id : undefined}
        onClick={() => setOpen((o) => !o)} onFocus={() => setOpen(true)} onBlur={(e) => { if (!wrap.current.contains(e.relatedTarget)) setOpen(false); }}>
        <span aria-hidden="true">i</span>
      </button>
      {open ? (
        <span role="tooltip" id={id} className="info-pop" ref={pop} style={{ transform: `translateX(calc(-50% + ${shift}px))`, "--shift": `${shift}px` }}>
          <strong>{entry.title}</strong>
          <span>{entry.text}</span>
        </span>
      ) : null}
    </span>
  );
}
