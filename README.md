# GTA Community Atlas

An interactive map of household income and population composition across Toronto, Peel, York, Durham and Halton. Built with Vite and Leaflet, using the same desktop rail, mobile menu and draggable details sheet as the Calgary and Edmonton atlases.

**Website** · https://curtisatiwatt.github.io/gta-census/

## Coverage and data

The map includes Markham, Richmond Hill and Vaughan, along with the other municipalities and census subdivisions within the five GTA census divisions. Search a city name or a census tract number, or choose a city or region from the map menu.

Statistics come directly from the Statistics Canada 2021 Census Profile. Income is median total before-tax household income in 2020, expressed in Canadian dollars. The population chart uses the Census visible-minority categories and their common private-household population denominator.

The mapped statistical areas are **census tracts**. They can differ from municipal neighbourhoods and familiar local names. For the three census subdivisions without tract coverage—Scugog, Brock and Mississaugas of Scugog Island—the map displays the official whole-subdivision boundary and statistics with an explicit municipal-level label.

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

Python scripts in `scripts/` retrieve and prepare source data, while Node validators run offline against the checked-in snapshots and outputs. Consult each script's command-line help and the matching audit files before refreshing a source. Geometry processing may require `shapely`, `pyproj` and `pyshp`.

The data preparation process records source identifiers, retrieval dates, selected characteristics and output hashes. Refreshing any public dataset requires updating its audit checksums and running `npm run check`.

## Publishing

The Pages workflow installs locked dependencies, runs application and data checks, builds with Vite and deploys `dist/`. GitHub Pages is configured to use **GitHub Actions**. Each deployment attempt uses a separate artifact name so retries can publish cleanly.

Public statistical and geographic data retain their source-specific attribution and licence terms. Metrolinx attribution is included in the data guide and transit audit. Leaflet retains its BSD licence.
