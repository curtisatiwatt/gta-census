# GTA Community Atlas

An interactive map of household income and population composition across Toronto, Peel, York, Durham and Halton. Built with Vite and Leaflet, using the same desktop rail, mobile menu and draggable details sheet as the Calgary and Edmonton atlases.

**Website** · https://curtisatiwatt.github.io/gta-census/

## Coverage and data

The map includes Markham, Richmond Hill and Vaughan, along with the other municipalities and census subdivisions within the five GTA census divisions. Search a city or neighbourhood name, or choose a city or region from the map menu. Tract codes remain searchable in the Census areas layer.

Statistics come directly from the Statistics Canada 2021 Census Profile. Income is median total before-tax household income in 2020, expressed in Canadian dollars. The population chart uses the Census visible-minority categories and their common private-household population denominator.

The default map uses **official named municipal neighbourhoods and planning areas**, then regional-government neighbourhoods where no suitable citywide municipal partition was obtained. The current snapshot contains **551 named municipal/regional display areas and 57 federal fallback areas** across 25 municipalities and two First Nations census subdivisions. Names and boundaries come from the responsible governments; this is not an inferred real-estate neighbourhood map.

Toronto uses its 158 Social Planning Neighbourhoods v3.0 and the matching City-published 2021 custom Census profiles. Mississauga uses 56 City neighbourhood/profile areas from the 2021 model, including neighbourhoods, nodes and employment areas; it is not labelled as the 2026 Official Plan 2051 geography. Pickering, Ajax, Oshawa, Brampton, Caledon, Oakville, Burlington, Milton and Halton Hills use their published named neighbourhood, planning-community or settlement polygons. York uses regional EDI neighbourhoods; five Durham municipalities use regional Health Neighbourhoods.

**Statistics only appear when an official table matches both the boundary and the definition.** Toronto has neighbourhood household-income medians and all 13 population categories. Mississauga has the 13 categories and household size, but no matching household-income median in the selected table. York's economic-family income and child-only demographic indicators, and Durham's after-tax income, are deliberately not substituted for the app's different measures. Missing values stay unavailable. Medians are never averaged or area-weighted.

Use **Choose area → Area boundaries**, or **Map layers → Area boundaries**, to switch to the independent **Census areas** layer. It retains all 1,339 original 2021 census tracts plus three whole-subdivision fallbacks. The detail panel also provides a “View census tracts here” shortcut. Original tract links still work; new city links preserve the selected boundary mode.

Municipal datasets do not all cover rural or undeveloped land. Their uncovered areas use federal fallback polygons; clipped fragments receive no whole-tract statistics. Complete official municipal schemes retain their own shorelines instead of being cut to a different federal coastline. Cross-municipal regional polygons are clipped only where necessary and then lose their full-area statistics. Small source boundary discrepancies are audited. The separately published Ashgrove rural cluster is removed from Georgetown's overlapping planning polygon; neither is assigned invented statistics.

City and region benchmarks use the published Census Profile values. The all-GTA population comparison adds the five regional counts, with a rounding note. A combined GTA household-income median is left unavailable because it cannot be calculated from published area medians. Missing or suppressed values remain missing and explicit zeroes remain zeroes.

Source definitions, geography notes, licences and attribution are available through **About the data** in the application. The repository includes preparation scripts, selected official source snapshots, audit records and integrity checks.

## Use the map

- **Composition** shows selected population groups as rings. Open the income layer to colour areas by household income.
- **Compare** shows one selected group as a population-share heat map. Switch groups using the comparison selector.
- **Choose groups** supports any combination of the published categories. A first visit starts with no selected population groups and income colouring off.
- **City / region** changes the map extent, available areas and benchmark population.
- **Map layers** controls roads, area labels, rail transit and geographic landmarks.
- **Legend** appears when relevant data layers are active and opens on demand.
- Click an area to open its statistics. Desktop hover outlines and selected boundaries are drawn above roads and water. Mobile details open halfway and can be dragged upward, downward or closed completely.
- Language and appearance initially follow the device, with manual Chinese/English and light/dark options.

The transit overlay includes official TTC rapid-transit, GO rail and UP Express routes and stations from the downloaded feeds. Transit, parks and airport layers can be enabled from the menu. Service times and live vehicle positions are outside this map's coverage.

## Development

Use Node.js 24 or a compatible version satisfying `package.json`.

```sh
npm ci
npm run dev
```

Vite provides the local development server and production preview.

```sh
npm run check
npm run build
npm run preview
```

The application is a static bundle with relative asset paths, suitable for GitHub Pages at `/gta-census/`. Viewing the published map requires no API key or application backend.

## Rebuilding data

Python scripts in `scripts/` retrieve and prepare source data, while Node validators run offline against the checked-in snapshots and outputs. `data/municipal/datasets.json` selects the adopted sources; regional `sources.json` manifests record URLs, licences, rejected alternatives and coverage. `data/municipal/audit.json` records source/output hashes, profile joins, clipping and per-city coverage. Consult each script's command-line help and the matching audit files before refreshing a source. Geometry processing may require `shapely`, `pyproj` and `pyshp`; Toronto workbook extraction uses `openpyxl`. Rebuild the selected Toronto rows with `python scripts/extract-toronto-neighbourhoods.py`, then run `python scripts/prepare-neighbourhoods.py` after any approved municipal-source refresh. The municipal validator runs as part of `npm run check`.

The data preparation process records source identifiers, retrieval dates, selected characteristics and output hashes. Refreshing any public dataset requires updating its audit checksums and running `npm run check`.

## Publishing

The Pages workflow installs locked dependencies, runs application and data checks, builds with Vite and deploys `dist/`. GitHub Pages is configured to use **GitHub Actions**. Each deployment attempt uses a separate artifact name so retries can publish cleanly.

Public statistical and geographic data retain their source-specific attribution and licence terms. Metrolinx attribution is included in the data guide and transit audit. Leaflet retains its BSD licence.
