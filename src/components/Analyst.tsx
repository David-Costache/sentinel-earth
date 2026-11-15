"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type Msg = { role: "user" | "assistant"; content: string };
const CITE = /\[(EONET_\d+|NEO:[^\]]+)\]/g;
const STARTERS = [
  "Which active wildfires are near populated areas this week?",
  "Summarise the storms being tracked right now.",
  "Which asteroid passes closest in the next 30 days, and how big is it?",
];

type Props = {
  seed: { q: string; n: number };
  label: (ref: string) => string | undefined; // undefined when the reference is not in the loaded data
  onCite: (ref: string) => void;
};

export default function Analyst({ seed, label, onCite }: Props) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const end = useRef<HTMLDivElement>(null);

  async function send(q: string) {
    q = q.trim();
    if (!q || busy) return;
    const history = [...msgs, { role: "user" as const, content: q }];
    setMsgs([...history, { role: "assistant", content: "" }]);
    setDraft("");
    setError("");
    setBusy(true);
    let text = "";
    try {
      const res = await fetch("/api/analyst", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: history }) });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error ?? `The analyst returned an error (${res.status}).`);
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += value;
        setMsgs([...history, { role: "assistant", content: text }]);
      }
      if (!text) throw new Error("The analyst sent no answer. Check the server log, then ask again.");
      // Fly to the first place the answer cites.
      const first = [...text.matchAll(CITE)].map((m) => m[1]).find((ref) => label(ref));
      if (first) onCite(first);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The request failed. Ask again.");
      setMsgs(text ? [...history, { role: "assistant", content: text }] : history);
    } finally {
      setBusy(false);
    }
  }

  // Questions sent from elsewhere in the app, e.g. "Ask the analyst" on an event.
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    if (seed.n) sendRef.current(seed.q);
  }, [seed]);

  useEffect(() => {
    // Braces matter: newer browsers return a promise here, and an effect must not return one.
    end.current?.scrollIntoView({ block: "nearest" });
  }, [msgs]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1" aria-live="polite">
        {msgs.length === 0 && (
          <>
            <p className="text-sm text-muted-foreground">
              Ask about what is on the globe. Answers come from the live NASA feeds, and each cited event is a button that flies you there.
            </p>
            {STARTERS.map((s) => (
              <button key={s} onClick={() => send(s)} className="block w-full rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-white/5">
                {s}
              </button>
            ))}
          </>
        )}
        {msgs.map((m, i) =>
          m.role === "user" ? (
            <p key={i} className="ml-8 rounded-md bg-white/8 px-3 py-2 text-sm">{m.content}</p>
          ) : (
            <p key={i} className="whitespace-pre-wrap text-sm leading-relaxed">
              {m.content
                ? m.content.split(CITE).map((part, j) => {
                    if (j % 2 === 0) return part;
                    const name = label(part);
                    return name ? (
                      <button key={j} onClick={() => onCite(part)} className="mx-0.5 rounded bg-primary/15 px-1.5 text-primary underline-offset-2 hover:underline">
                        {name}
                      </button>
                    ) : (
                      <span key={j} className="text-muted-foreground">[{part}]</span>
                    );
                  })
                : <span className="text-muted-foreground">Checking the feeds…</span>}
            </p>
          ),
        )}
        {error && <p role="alert" className="rounded-md border border-destructive/50 px-3 py-2 text-sm">{error}</p>}
        <div ref={end} />
      </div>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); send(draft); }}>
        <label htmlFor="ask" className="sr-only">Question for the analyst</label>
        <input
          id="ask"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={2000}
          placeholder="Ask about fires, storms or asteroids"
          className="min-w-0 flex-1 rounded-md border border-input bg-black/20 px-3 py-2 text-sm placeholder:text-muted-foreground"
        />
        <Button type="submit" disabled={busy || !draft.trim()}>{busy ? "Asking" : "Ask"}</Button>
      </form>
    </div>
  );
}
