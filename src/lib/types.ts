export type EonetEvent = {
  id: string;
  title: string;
  category: string;
  categoryTitle: string;
  date: string; // latest report
  started: string; // first report
  lat: number;
  lng: number;
  magnitude?: string;
  source?: string;
  track?: [number, number][]; // [lat, lng] history, for moving events such as storms
};

export type Neo = {
  des: string;
  date: string;
  distLd: number;
  distKm: number;
  vKms: number;
  diameterM: number;
  diameterEstimated: boolean;
  hazardous?: boolean;
};

export type Feed<T> = { items: T[]; stale: boolean; fetchedAt: string };

export type SpaceEvent = {
  id: string;
  kind: "flare" | "cme" | "storm" | "stream";
  time: string;
  label: string; // e.g. "Kp 6 storm", "CME at 303 km/s"
  value?: number; // Kp index, CME speed in km/s
  note?: string;
  link?: string;
};

export type EpicImage = { date: string; url: string; caption: string; lat: number; lon: number };
