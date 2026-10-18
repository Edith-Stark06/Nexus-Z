import { useEffect, useRef } from "react";
import { Play, Pause, SkipBack } from "lucide-react";
import { edgeTimestamps, msToIso } from "../lib/replay";
import { formatUtc } from "../lib/constants";
import "./ReplaySlider.css";

// Slider over the ring's payment times, with play and pause.
//
// `onT` emits the chosen cutoff as an ISO string so the parent can slice the payments with edgesUpTo: only payments at or before
// that time are drawn, the same "no peeking into the future" rule the model follows. `t` null means "everything" (slider at the end).
export default function ReplaySlider({ edges, t, onT, playing, onPlay }) {
  const times = edgeTimestamps(edges);
  const raf = useRef(null);

  const idx = t == null ? -1 : times.findIndex((ms) => ms === new Date(t).getTime());
  const safeIdx = idx >= 0 ? idx : times.length - 1;

  useEffect(() => {
    if (!playing || times.length === 0) return undefined;
    let active = true;
    let last = performance.now();
    const step = (now) => {
      if (!active) return;
      if (now - last > 400) {
        last = now;
        const next = Math.min(times.length - 1, safeIdx + 1);
        if (next > safeIdx) onT(msToIso(times[next]));
        else onPlay(false);
      }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      active = false;
      if (raf.current) cancelAnimationFrame(raf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, times.length, safeIdx]);

  if (times.length === 0) return <div className="replay-empty faint">No payments to replay.</div>;

  const shown = msToIso(times[safeIdx]);
  const atEnd = safeIdx === times.length - 1;
  return (
    <div className="replay">
      <div className="replay-head">
        <span className="eyebrow">Replay</span>
        <span className="replay-now mono">
          payments up to {formatUtc(shown)}
          <span className="faint"> · {safeIdx + 1} of {times.length} moments</span>
        </span>
      </div>
      <div className="replay-bar">
        <button className="icon" onClick={() => onPlay(!playing)} aria-label={playing ? "Pause replay" : "Play replay"} title={playing ? "Pause" : atEnd ? "Replay from the start" : "Play"}>
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <button className="icon ghost" onClick={() => { onPlay(false); onT(msToIso(times[0])); }} aria-label="Go to the first payment" title="Back to the first payment">
          <SkipBack size={14} />
        </button>
        <input
          className="replay-range"
          type="range"
          min={0}
          max={Math.max(0, times.length - 1)}
          value={safeIdx}
          aria-label="Replay position"
          aria-valuetext={formatUtc(shown)}
          onChange={(e) => onT(msToIso(times[Number(e.target.value)]))}
        />
        <button className="ghost replay-all" onClick={() => { onPlay(false); onT(null); }} disabled={atEnd && t == null} title="Show every payment">
          Show all
        </button>
      </div>
    </div>
  );
}
