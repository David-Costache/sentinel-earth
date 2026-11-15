const SOURCES = [
  ["NASA EONET v3", "https://eonet.gsfc.nasa.gov/docs/v3", "open natural events, refreshed every 10 minutes"],
  ["NASA GIBS", "https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api", "daily satellite imagery tiles"],
  ["JPL SBDB Close-Approach API", "https://ssd-api.jpl.nasa.gov/doc/cad.html", "asteroid passes for the next 30 days"],
  ["NASA NeoWs", "https://api.nasa.gov/", "asteroid sizes and hazard flags"],
] as const;

export default function About() {
  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1 text-sm leading-relaxed">
      <p>
        NASA publishes what is happening to the planet across many separate services. Sentinel Earth puts four of them on one globe,
        so a disaster analyst can see a fire, the satellite pass that imaged it and the days leading up to it without switching tools.
      </p>
      <div>
        <h3 className="font-heading font-semibold">Who it is for</h3>
        <p className="text-muted-foreground">
          NASA Earth Applied Sciences and Disasters program staff, emergency managers they support, and anyone briefing
          non-specialists. Every view has a link you can share, so a briefing can open on the exact event, layer and date.
        </p>
      </div>
      <div>
        <h3 className="font-heading font-semibold">How to use it</h3>
        <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>Pick an event from the list or the globe.</li>
          <li>Switch the imagery layer and drag the date to watch it develop.</li>
          <li>Ask the analyst a question. It queries the same feeds and cites what it used.</li>
        </ol>
      </div>
      <div>
        <h3 className="font-heading font-semibold">Data sources</h3>
        <ul className="space-y-1 text-muted-foreground">
          {SOURCES.map(([name, href, what]) => (
            <li key={name}>
              <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">{name}</a>: {what}
            </li>
          ))}
        </ul>
      </div>
      <p className="text-xs text-muted-foreground">
        If a NASA service does not respond, the app shows the last data it saved and says so. Asteroid sizes marked
        &ldquo;about&rdquo; are estimated from brightness. Built for NASA Space Apps Challenge 2026. Not an official NASA product.
      </p>
    </div>
  );
}
