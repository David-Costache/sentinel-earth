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
