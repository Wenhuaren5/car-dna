# Car DNA — Frontend MVP

**Inspired by Nature. Designed for Modern Life.**

A local-only React + Vite prototype that captures a validated `UserDemandProfile` for future
demand modeling, genetic vehicle evolution, and real-vehicle matching. It does not fabricate
routes, prices, costs, or recommendations.

## Start

```powershell
cd C:\Users\18969\Desktop\hackathon
npm install
npm run dev
```

Open the local URL printed by Vite (normally `http://localhost:5173`). Production check:
`npm run build`. No environment variables and no API keys are required.

## Step 3 — Local Driving Map (San Jose, offline)

Step 3 is a self-contained driving simulator for San Jose. The base map is drawn from vector
files that live inside this project; **no online map service is contacted at runtime**.

- Coverage: the OpenStreetMap extract of San Jose and its immediate surroundings
  (`37.21…37.46 N`, `122.081…121.707 W`). Leaflet's `maxBounds` keeps the map inside it.
- Interaction: zoom, pan, click the map to select a location, drag the temporary pin, save it as
  **Home** or as a **frequently visited place**, then edit, move or delete it in *Your Places*.
- Addresses: every selected point is looked up in a **local reverse-geocoding index** built from
  OpenStreetMap `addr:*` tags (286,254 addresses, 11,140 street names, 3,257 postcodes). The
  ladder is honest: a mapped house number inside 70 m → *Nearest known address*, else the nearest
  mapped road name → *Nearest mapped road*, else the nearest mapped area name → *Nearest mapped
  area*, else the coordinates plus **Address unavailable**. House numbers are never interpolated
  and never derived from a road, and a point is never given a number the data does not state.
- Daily mileage: every destination gets a **real driving distance** from an offline A* search
  over the local road network (`2 × one-way road distance × round trips/week × weeks/year`).
  Straight-line distance is never substituted for a road distance.
- Facilities: 170 EV charging stations and 332 gas stations, deduplicated, with
  `source`, `license` and `retrievedAt`. Missing values show **Unknown**.
- Long-distance driving is a separate module where the user types trips per year and miles
  per round trip; the annual total is their product. No map selection is required.
- Annual Mileage Summary stores `dailyDrivingMiles`, `longDistanceMiles` and
  `totalAnnualMiles` on the profile for Algorithm 1, and never overwrites the user's own
  `annualMileage` entry.

Local data sizes: basemap `2.02 MB`, offline road graph `1.64 MB`, address index `6.19 MB`
(48 shards, one shard per click: `~130 KB` average, `424 KB` worst case), facilities `0.26 MB`.
Nothing is downloaded from the network while the app runs.

See `tools/README.md` for the data provenance, licence, sizes and the rebuild commands.

## Structure

```text
public/map/           local vector basemap, place labels, road graph, manifest
public/map/addresses/ offline reverse-geocoding index (shard catalogue + address shards)
public/data/          local EV charging and gas station records
tools/                build-time data pipeline, font download, routing/address tests, acceptance test
src/
  algorithms/         Explicit future interfaces; all throw "not implemented"
  components/         Local map, pending-selection panel, Your Places panel, address display
  services/           Local data loaders, offline A* routing, offline reverse geocoding
  utils/              Distance math, polyline decoding, facility field formatting
  model/              UserDemandProfile defaults, migration, validation
  storage/            localStorage and JSON export
  App.jsx             Landing, five-step wizard, summary
  styles.css          Responsive visual system
```

## Data boundaries

`rawUserInput` holds answers, coordinates, and the round-trip / weeks-per-year settings. Home and
every frequent destination also carry a `customName` (the user's own note), a `type`, and an
`address` object:

```json
{
  "id": "destination_1",
  "type": "School",
  "customName": "De Anza College",
  "lat": 37.3229,
  "lng": -122.0454,
  "address": {
    "displayName": "21251 Stevens Creek Boulevard, Cupertino, CA",
    "precision": "house",
    "relation": "nearest",
    "matchLabel": "Nearest known address",
    "components": {"houseNumber": "21251", "street": "Stevens Creek Boulevard",
                   "city": "Cupertino", "state": "CA", "postcode": "95014"},
    "distanceMetres": 41,
    "confidence": "medium",
    "source": "OpenStreetMap (ODbL 1.0)",
    "sourceKind": "address point (mapped node)"
  },
  "roundTripsPerWeek": 5,
  "weeksPerYear": 40
}
```

A house-number answer is a *reference* to the closest mapped address, so `relation` stays
`"nearest"` and the interface says **Nearest known address** with the measured distance; it is
never presented as proof that the clicked point *is* that address. Each destination also carries
the measured `routeDistanceMiles` so the annual mileage stays reproducible offline after a
reload. `derivedData.routing` records the routing method, data source, per-destination distances,
snap distances, street names, and the expansion count of the A* search. `dailyDrivingMiles`,
`longDistanceMiles` and `totalAnnualMiles` are stored on the profile, while `annualMileage` (the
optional figure the user types in Step 4) is kept completely separate.

Places stored by earlier versions (`homeLocation: {lat, lng}` and destinations with a `name`
instead of `customName`) migrate losslessly: names, trips per week and weeks per year are kept,
and the missing address is resolved from the local index the next time Step 3 is opened.

The app never claims live charger availability, connector counts or fuel prices; anything the
data source does not state is rendered as **Unknown**. Facility radius counts near Home use
Haversine straight-line distance and are labelled as such.

The MVP supports vehicle purchase only, with `purchaseIntention` fixed to `"buy"`. Legacy
lease/rent records are migrated without converting monthly/daily rental amounts into a
purchase budget. Energy costs, vehicle pricing, genetic evolution, and real-world
recommendations remain intentionally unimplemented.

## GitHub Pages

The build is fully static (`base: './'`), so `dist/` can be published as-is from a repository
root or from a project sub-path. All data URLs are resolved against the document base, and no
server-side code is needed. A PWA/service worker is intentionally not part of this phase.

## 3D vehicle exterior

The five standard body styles use local, unbranded GLB exteriors from the
Innerscene 3D Parts Library, released under CC0 1.0 (public domain):

| Body style | File | Source model | Triangles |
| --- | --- | --- | --- |
| Sedan | `public/models/sedan.glb` | Red four-door sedan | 132,082 |
| Hatchback | `public/models/hatchback.glb` | Blue five-door compact hatchback | 130,902 |
| SUV / Crossover | `public/models/suv.glb` | Charcoal five-door crossover SUV | 133,178 |
| Minivan (MPV) | `public/models/minivan.glb` | Passenger van with side windows, adapted | 147,492 |
| Pickup Truck | `public/models/pickup.glb` | Crew-cab pickup with open bed | 145,816 |

The minivan starts from the CC0 passenger-van model. To avoid presenting a
commercial high-roof van as a family MPV, the derivative scales its length to
0.90× and compresses the cabin above 1.25 m to 0.62× height. The wheels, glazing,
lights and lower body are unchanged. The exact adaptation and source URL are
recorded in `src/components/glbCarModel.js`.

Each model is a fixed presentation asset: the decoded DNA never resizes it, and
its provenance, license, byte size and triangle count are recorded in
`src/components/glbCarModel.js`. During the concept reveal the selected GLB
fades in over the procedural assembly, then replaces the printed shell. Only the
current body's GLB is requested; the five files are not downloaded together.
Body types without a verified local GLB keep the procedural concept car, and any
load or preparation failure falls back to it automatically. Switching the final
body in the Studio swaps the GLB in the existing canvas without regenerating the
DNA.

Body-type images are stored locally in `public/images/body-types/`, lazy-loaded in the
questionnaire, and served as compressed WebP files. The six active vehicle images are
deterministic crops from the user-provided `Car Types Overview`; provenance and processing
details are documented in `public/images/body-types/CREDITS.md`. The reference image is used
only for visual classification—not as a source of dimensions, efficiency, or
vehicle-performance data.

