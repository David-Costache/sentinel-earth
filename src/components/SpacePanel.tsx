import type { SpaceEvent } from "@/lib/types";

const when = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC", hour12: false });
const NAMES: Record<SpaceEvent["kind"], string> = { flare: "solar flares", cme: "coronal mass ejections", stream: "high-speed streams", storm: "geomagnetic storms" };

export default function SpacePanel({ items }: { items: SpaceEvent[] }) {
  const count = (k: SpaceEvent["kind"]) => items.filter((s) => s.kind === k).length;
  const kinds = (Object.keys(NAMES) as SpaceEvent["kind"][]).filter(count);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Space weather from the Sun in the last 30 days: {kinds.map((k) => `${count(k)} ${NAMES[k]}`).join(", ")}.
        Strong storms can disturb satellites, GPS and power grids.
      </p>
      <ul className="min-h-0 flex-1 overflow-y-auto pr-1">
        {items.map((s) => (
          <li key={s.id} className="border-b border-border/50 py-2 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className={s.kind === "storm" ? "font-medium text-primary" : "font-medium"}>{s.label}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{when.format(new Date(s.time))} UTC</span>
            </div>
            {s.note && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer py-1 hover:text-foreground">Forecaster note</summary>
                <p className="pb-1">{s.note}</p>
              </details>
            )}
            {s.link && <a href={s.link} target="_blank" rel="noreferrer" className="text-xs text-primary underline underline-offset-2">NASA DONKI record</a>}
          </li>
        ))}
      </ul>
    </div>
  );
}
