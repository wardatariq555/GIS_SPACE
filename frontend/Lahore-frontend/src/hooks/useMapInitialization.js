import { useEffect } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import maplibreCspWorkerUrl from "maplibre-gl/dist/maplibre-gl-csp-worker.js?url";

const RASTER_BASEMAP_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: [
        "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png"
      ],
      tileSize: 256,
      attribution: "&copy; OpenStreetMap contributors"
    }
  },
  layers: [
    {
      id: "osm-raster",
      type: "raster",
      source: "osm"
    }
  ]
};

function useMapInitialization(mapRef, mapContainerRef) {
  useEffect(() => {
    if (mapRef.current || !mapContainerRef.current) {
      return;
    }

    // Use the CSP worker entry so map startup works in browsers/sites
    // that block eval/blob-based worker bootstrapping.
    maplibregl.setWorkerUrl(maplibreCspWorkerUrl);

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: RASTER_BASEMAP_STYLE,
      center: [74.3587, 31.5204],
      zoom: 11,
      minZoom: 9,
      maxZoom: 17
    });

    map.on("load", () => {
      // Ensures the canvas gets sized correctly in all browser/layout states.
      map.resize();
    });

    map.on("error", (event) => {
      console.error("Map rendering error:", event?.error ?? event);
    });

    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "bottom-right"
    );
    map.addControl(
      new maplibregl.ScaleControl({ unit: "metric" }),
      "bottom-left"
    );

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [mapRef, mapContainerRef]);
}

export default useMapInitialization;
