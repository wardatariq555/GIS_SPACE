# Lahore Walkability Frontend

React + Vite frontend for the Lahore 15-minute city analysis.

## What This UI Does

1. Shows a grayscale city basemap with Lahore boundary.
2. User clicks a location to run walkability analysis.
3. Renders nested isochrones:
   - 5 min (inner)
   - 10 min (middle)
   - 15 min (outer)
4. Renders only reachable POIs returned by backend.
5. Lets user filter POIs by category (healthcare, schools, parks, transit, markets).
6. Shows summary counts by zone.

## Key Files

- `src/components/MapView.jsx`: top-level map screen and UI state wiring.
- `src/components/LayerPanel.jsx`: left control panel (legend, toggles, summary).
- `src/hooks/useMapInitialization.js`: map creation and controls.
- `src/hooks/useBoundaryLayer.js`: boundary fetch and render.
- `src/hooks/usePoisLayer.js`: click analysis, zone rendering, POI filtering, popups.
- `src/services/api.js`: backend API helpers and base URL handling.

## Local Run

1. Install dependencies:
   - `npm install`
2. Start dev server:
   - `npm run dev`

Default backend URL is `http://localhost:5109`.

To override:

- create `.env` in this folder with:
  - `VITE_API_BASE_URL=http://localhost:5109`

## Interaction Notes

- Click map background to run analysis.
- Click a green POI to open details popup.
- Use category chips to filter currently reachable POIs.
- Use **Clear Map** to remove current analysis layers.

