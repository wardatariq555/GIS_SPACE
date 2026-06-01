import { useEffect } from "react";
import { getBoundary } from "../services/api";

const BOUNDARY_SOURCE_ID = "lahore-boundary-source";
const BOUNDARY_FILL_LAYER_ID = "lahore-boundary-fill";
const BOUNDARY_LINE_LAYER_ID = "lahore-boundary-line";

function removeBoundaryLayers(mapRef) {
  if (mapRef.getLayer(BOUNDARY_LINE_LAYER_ID)) {
    mapRef.removeLayer(BOUNDARY_LINE_LAYER_ID);
  }

  if (mapRef.getLayer(BOUNDARY_FILL_LAYER_ID)) {
    mapRef.removeLayer(BOUNDARY_FILL_LAYER_ID);
  }

  if (mapRef.getSource(BOUNDARY_SOURCE_ID)) {
    mapRef.removeSource(BOUNDARY_SOURCE_ID);
  }
}

function useBoundaryLayer(mapRef) {
  useEffect(() => {
    if (!mapRef.current) {
      return;
    }

    let isCancelled = false;

    async function drawBoundary() {
      try {
        const boundaryGeojson = await getBoundary();
        if (isCancelled || !mapRef.current) {
          return;
        }

        removeBoundaryLayers(mapRef.current);

        mapRef.current.addSource(BOUNDARY_SOURCE_ID, {
          type: "geojson",
          data: boundaryGeojson
        });

        mapRef.current.addLayer({
          id: BOUNDARY_FILL_LAYER_ID,
          type: "fill",
          source: BOUNDARY_SOURCE_ID,
          paint: {
            "fill-color": "#f8fafc",
            "fill-opacity": 0.02
          }
        });

        mapRef.current.addLayer({
          id: BOUNDARY_LINE_LAYER_ID,
          type: "line",
          source: BOUNDARY_SOURCE_ID,
          paint: {
            "line-color": "#475569",
            "line-width": 1.2,
            "line-opacity": 0.7
          }
        });
      } catch (error) {
        console.error("Failed to load Lahore boundary:", error);
      }
    }

    if (mapRef.current.isStyleLoaded()) {
      drawBoundary();
    } else {
      mapRef.current.once("load", drawBoundary);
    }

    return () => {
      isCancelled = true;
    };
  }, [mapRef]);
}

export default useBoundaryLayer;
