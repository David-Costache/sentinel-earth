"use client";

import { useEffect, useState } from "react";

// Mission clock. Ticks in its own component so the rest of the screen does not re-render each second.
export default function Clock({ saved }: { saved: boolean }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const dot = saved ? "bg-primary" : "bg-[#2fc46b]";

  return (
    <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
      <span className="relative flex size-2" aria-hidden>
        {!saved && <span className={`absolute inline-flex size-full rounded-full opacity-60 motion-safe:animate-ping ${dot}`} />}
        <span className={`relative size-2 rounded-full ${dot}`} />
      </span>
      <span className="text-foreground">{saved ? "Saved data" : "Live"}</span>
      <time dateTime={now.toISOString()} className="tabular-nums">{now.toISOString().slice(11, 19)} UTC</time>
    </p>
  );
}
