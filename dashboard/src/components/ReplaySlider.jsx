import { useEffect, useRef, useState } from "react";
import { edgeTimestamps, msToIso } from "../lib/replay";
import "./ReplaySlider.css";

// Slider over the ring's edge timestamps, with play/pause.
//
// `onT` emits the current cutoff timestamp (an ISO string) so the parent can
// slice the edges with edgesUpTo. The parent holds the chosen t; this component
// only owns the slider position and the playing state.
export default function ReplaySlider({ edges, t, onT, playing, onPlay }) {
  const times = edgeTimestamps(edges);
  const [dragging, setDragging] = useState(false);
  const raf = useRef(null);

  const idx = times.findIndex((ms) => ms === new Date(t).getTime());
  const safeIdx = idx >= 0 ? idx : times.length - 1;

  useEffect(() => {
    if (!playing || times.length === 0) return;
    if (raf.current) cancelAnimationFrame(raf.current);
    let active = true;
    let last = performance.now();
    const step = (now) => {
      if (!active) return;
      if (now - last > 400) {
        last = now;
        const next = Math.min(times.length - 1, safeIdx + 1);
        if (next > safeIdx) {
          onT(msToIso(times[next]));
        } else {
          onPlay(false);
        }
      }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      active = false;
      if (raf.current) cancelAnimationFrame(raf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, times.length]);

  if (times.length === 0) {
    return <div className="replay-empty">No edges to replay.</div>;
  }

  return (
    <div className="replay">
      <div className="replay-bar">
        <span className="replay-time">{msToIso(times[0])}</span>
        <input
          className="replay-range"
          type="range"
          min={0}
          max={Math.max(0, times.length - 1)}
          value={safeIdx}
          onChange={(e) => onT(msToIso(times[Number(e.target.value)]))}
          onMouseDown={() => setDragging(true)}
          onMouseUp={() => setDragging(false)}
          onTouchStart={() => setDragging(true)}
          onTouchEnd={() => setDragging(false)}
        />
        <span className="replay-time">{msToIso(times[times.length - 1])}</span>
      </div>
      <div className="replay-controls">
        <span className="replay-count">
          {safeIdx + 1} of {times.length} moments
        </span>
        <button
          className="replay-play"
          onClick={() => {
            if (!playing && safeIdx >= times.length - 1 && times.length > 1) onT(msToIso(times[0])); // at the end, Play starts over
            onPlay(!playing);
          }}
          aria-label={playing ? "Pause replay" : "Play replay"}
        >
          {playing ? "Pause" : "Play"}
        </button>
        <span className="replay-hint">
          {dragging ? "dragging" : playing ? "advancing" : "paused"}
        </span>
      </div>
    </div>
  );
}