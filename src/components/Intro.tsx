"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import type { EonetEvent, Feed, Neo } from "@/lib/types";

type Props = {
  events?: Feed<EonetEvent>;
  neos?: Feed<Neo>;
  failed: boolean;
  onOpen: () => void;
};

// Staggered entrance: delays in seconds, see the .intro-rise rule in globals.css.
const rise = (delay: number) => ({ animationDelay: `${delay}s` });

export default function Intro({ events, neos, failed, onOpen }: Props) {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => button.current?.focus(), []);

  // Enter and Esc work wherever focus is, e.g. after dragging the globe behind the panel.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === "Escape") onOpen();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onOpen]);

  const loaded = events && neos;
  const saved = events?.stale || neos?.stale;

  return (
    <section
      aria-label="Welcome"
      data-intro
      className="intro-panel hud absolute inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] max-h-[60svh] overflow-y-auto rounded-[28px] p-5 lg:inset-x-auto lg:bottom-[clamp(24px,6vh,72px)] lg:left-[clamp(24px,4vw,64px)] lg:w-[min(520px,42vw)] lg:p-8"
    >
      <h1 className="intro-rise text-balance font-heading text-[clamp(2.5rem,6vw,5rem)] font-medium leading-[0.98] tracking-[-0.03em]" style={rise(0.2)}>
        Sentinel Earth
      </h1>
      <p className="intro-rise mt-4 max-w-[28rem] text-[17px] leading-[1.55] text-foreground/80" style={rise(0.32)}>
        Live NASA data on wildfires, storms, space weather and passing asteroids, on one globe. Built for disaster analysts and anyone briefing them.
      </p>

      {!failed && (
        <div className="intro-rise mt-5 min-h-[3.75rem] text-[15px] leading-[1.5] text-foreground/60" style={rise(0.44)} data-testid="intro-fact">
          {loaded ? (
            <p className="tabular-nums">
              <strong className="font-semibold text-foreground">{events.items.length}</strong> natural events are open right now, and{" "}
              <strong className="font-semibold text-foreground">{neos.items.length}</strong> asteroids pass within 20 lunar distances in the next 30 days.
              {saved && " Showing saved data."}
            </p>
          ) : (
            <div role="status" className="space-y-2.5 pt-1">
              <span className="sr-only">Loading live counts</span>
              <div className="skeleton h-4 w-full" />
              <div className="skeleton h-4 w-2/3" />
            </div>
          )}
        </div>
      )}

      <div className="intro-rise mt-6 flex flex-wrap items-center gap-x-5 gap-y-3" style={rise(0.56)}>
        <Button
          ref={button}
          onClick={onOpen}
          className="h-12 rounded-full px-7 text-[15px] font-medium transition-transform duration-200 hover:scale-[1.03] active:scale-[0.97]"
        >
          Open the console
        </Button>
        <p className="text-xs text-foreground/50">Not an official NASA product.</p>
      </div>
    </section>
  );
}
