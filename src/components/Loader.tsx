"use client";

import dynamic from "next/dynamic";

// WebGL and URL state are browser-only, so the whole console renders on the client.
export default dynamic(() => import("./Sentinel"), {
  ssr: false,
  loading: () => (
    <main className="grid h-svh place-items-center">
      <p className="text-muted-foreground">Loading Sentinel Earth…</p>
    </main>
  ),
});
