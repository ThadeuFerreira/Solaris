# Solaris — simulador solar

Web app to visualize solar panels on a roof and estimate how much energy they
produce and how much they save, focused on Brazil. The interface is in
Portuguese (pt-BR).

1. Search an address (or use your location) and zoom into the roof on the
   satellite map.
2. Draw the available area with the polygon or rectangle tool.
3. Solaris packs real-size modules into the area, then estimates monthly and
   lifetime production, the local kWh price and the payback.

Everything is fetched from public APIs at runtime; nothing is stored.

## Data sources

| What | Source | Notes |
|---|---|---|
| Map & drawing | [Leaflet](https://leafletjs.com/), [Leaflet-Geoman](https://geoman.io/) (MIT) | Polygon/rectangle drawing, edit, drag, rotate |
| Base maps | [Esri World Imagery](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9) (satellite), [OpenStreetMap](https://www.openstreetmap.org/copyright) | Attribution shown on the map |
| Geocoding | [Nominatim](https://nominatim.org/) (OSM) | Search runs only on submit, per the [usage policy](https://operations.osmfoundation.org/policies/nominatim/) |
| Solar irradiance & temperature | [NASA POWER](https://power.larc.nasa.gov/) climatology API | Monthly GHI, clear-sky GHI and air temperature, 2001–2020, no key |
| Electricity tariffs | [ANEEL Dados Abertos](https://dadosabertos.aneel.gov.br/dataset/tarifas-distribuidoras-energia-eletrica) (CKAN datastore, resource `fcf2906c-7c32-4b9b-a637-054e7a5234f4`) | Residential B1 conventional *Tarifa de Aplicação* (TUSD + TE) for every distributor, with history |
| Tariff flags | [ANEEL — Bandeiras tarifárias](https://dadosabertos.aneel.gov.br/dataset/bandeiras-tarifarias) (resource `0591b8f6-fe54-437b-b72b-1aa2efd46e42`) | Current flag and surcharge |
| Modules | WEG datasheets ([WPV 550/555 HMM0](https://static.weg.net/medias/downloadcenter/h13/he1/WEG-wpv-550-555-hmm0-datasheet-pt.pdf)) | WEG has no public product API, so specs are in `src/data/panels.ts` |

PVGIS (EU JRC) was considered, but its API does not allow browser (AJAX) calls.

### ANEEL and CORS

The app calls the ANEEL portal directly from the browser. If the portal
doesn't send CORS headers, it falls back to the same-origin path `/aneel-api/…`,
which `vite.config.ts` proxies to `https://dadosabertos.aneel.gov.br` in both
`npm run dev` and `npm run preview`. For static hosting, add an equivalent
rewrite. For example, on Netlify:

```
/aneel-api/*  https://dadosabertos.aneel.gov.br/:splat  200
```

If ANEEL can't be reached at all, the tariff panel says so and lets the user
type the price from their bill.

## How the estimate works

- **Sun from latitude**: solar declination, day length, noon elevation and
  extraterrestrial irradiation (Duffie & Beckman). If NASA POWER is
  unavailable, monthly irradiation is estimated as 0.52 × extraterrestrial.
- **Irradiance on the panels**: Erbs diffuse split and Liu & Jordan isotropic
  sky, integrated over the day, so any tilt and azimuth works. The optimal tilt
  is searched for the chosen azimuth.
- **Layout**: the polygon is projected to local metres. Modules are packed in
  rows perpendicular to the facing direction, respecting the edge setback. The
  tilt shortens each module's horizontal footprint. On flat roofs or the ground,
  rows are spaced so they don't shade each other between 9h and 15h at the
  winter solstice.
- **Production**: kWp × peak sun hours × days × (1 − losses) × temperature
  factor. Cell temperature comes from NASA air temperature and module NOCT.
  Degradation follows the linear warranty (e.g. WEG: 2% in year 1, then
  0.55%/year).
- **Price**: (TUSD + TE + flag surcharge) ÷ (1 − ICMS − PIS/COFINS). ICMS
  defaults to each state's standard (modal) rate in `src/data/distributors.ts`.
  These are reference values; check them against a real bill.
- **Savings**: with Lei 14.300/2022, injected energy progressively pays the
  Fio B (60% in 2026 → 100% from 2029; Fio B share and simultaneous
  self-consumption are editable). When a monthly consumption is entered,
  savings are capped at consumption minus the minimum bill (30/50/100 kWh).
- **Tariff growth**: defaults to the distributor's average yearly change in
  ANEEL's history over the last 8 years, capped at 12%.

This is a planning estimate. A real project needs a site survey, a shading
analysis and the distributor's approval.

## Development

```bash
npm install
npm run dev       # http://localhost:5173
npm test          # unit tests (solar geometry, layout, finance, ANEEL parsing)
npm run lint
npm run build && npm run preview
```

Stack: React 19, TypeScript, Vite, react-leaflet, Leaflet-Geoman, Recharts.

```
src/
  api/          NASA POWER, ANEEL (CKAN) and Nominatim clients
  data/         WEG/generic module catalogue, distributor hints, ICMS
  lib/          solar geometry, panel layout, PV production & finance (pure, tested)
  components/   map, settings cards, charts, results
  model.ts      settings and defaults
```

## Known limitations / next steps

- One drawn area at a time. Roofs with several faces need one simulation per face.
- Obstacles (water tanks, chimneys) and shading from neighbours aren't modelled.
- The distributor is guessed from the state/city (ANEEL publishes concession
  areas only as GIS layers). Users can change it.
- The Fio B share is a single editable percentage. ANEEL's *componentes
  tarifárias* dataset could provide the exact value per distributor.
- Inverter sizing (e.g. WEG SIW line) isn't included yet.
