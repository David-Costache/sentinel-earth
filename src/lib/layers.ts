export type Layer = { id: string; name: string; note: string; gibs: string; matrix: string; ext: string; fixedDate?: string };

// Opaque NASA GIBS base layers in web mercator, each checked against the live WMTS service.
export const LAYERS: Layer[] = [
  { id: "truecolor", name: "True color", note: "Terra MODIS, as the eye would see it. Black strips are gaps between orbits.", gibs: "MODIS_Terra_CorrectedReflectance_TrueColor", matrix: "GoogleMapsCompatible_Level9", ext: "jpg" },
  { id: "burn", name: "Fire and burn scars", note: "Terra MODIS bands 7-2-1. Burned land shows red-brown, active fire bright red, vegetation green.", gibs: "MODIS_Terra_CorrectedReflectance_Bands721", matrix: "GoogleMapsCompatible_Level9", ext: "jpg" },
  { id: "sst", name: "Sea surface temperature", note: "GHRSST MUR analysis. Warm water feeds storms.", gibs: "GHRSST_L4_MUR_Sea_Surface_Temperature", matrix: "GoogleMapsCompatible_Level7", ext: "png" },
  { id: "night", name: "City lights", note: "VIIRS Black Marble, 2016 composite. Shows where people live.", gibs: "VIIRS_Black_Marble", matrix: "GoogleMapsCompatible_Level8", ext: "png", fixedDate: "2016-01-01" },
  { id: "bluemarble", name: "Blue Marble", note: "Cloud-free composite, for orientation.", gibs: "BlueMarble_NextGeneration", matrix: "GoogleMapsCompatible_Level8", ext: "jpeg", fixedDate: "2004-08-01" },
];

export const tileUrl = (l: Layer, date: string) => (x: number, y: number, z: number) =>
  `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${l.gibs}/default/${l.fixedDate ?? date}/${l.matrix}/${z}/${y}/${x}.${l.ext}`;

// Fixed order, never cycled. Checked with the dataviz palette validator against the panel surface
// (#101b3a): passes lightness, chroma, colour-blind separation and 3:1 contrast. Other types share one grey.
export const CATEGORY_COLORS: Record<string, string> = {
  wildfires: "#d95926",
  seaLakeIce: "#199e70",
  severeStorms: "#3987e5",
  volcanoes: "#c98500",
  floods: "#d55181",
  earthquakes: "#0ca30c",
};
export const OTHER_COLOR = "#9aa6c8";
export const CATEGORY_ORDER = Object.keys(CATEGORY_COLORS);
export const colorOf = (category: string) => CATEGORY_COLORS[category] ?? OTHER_COLOR;
