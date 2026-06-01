import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { buildAnalysisUrl } from "../services/api";

const ANALYSIS_SOURCE_ID = "analysis-zones-source";
const REACHABLE_POIS_SOURCE_ID = "reachable-pois-source";
const CLICKED_POINT_SOURCE_ID = "clicked-point-source";

const REACHABLE_POIS_LAYER_ID = "reachable-pois-layer";
const CLICKED_POINT_LAYER_ID = "clicked-point-layer";

const ZONE_LAYERS = [
  {
    minutes: 15,
    fillId: "analysis-zone-15-fill",
    lineId: "analysis-zone-15-line",
    fillColor: "#fef3c7",
    fillOpacity: 0.36,
    lineColor: "#f59e0b"
  },
  {
    minutes: 10,
    fillId: "analysis-zone-10-fill",
    lineId: "analysis-zone-10-line",
    fillColor: "#fde68a",
    fillOpacity: 0.42,
    lineColor: "#d97706"
  },
  {
    minutes: 5,
    fillId: "analysis-zone-5-fill",
    lineId: "analysis-zone-5-line",
    fillColor: "#fbbf24",
    fillOpacity: 0.52,
    lineColor: "#b45309"
  }
];

const EMPTY_FEATURE_COLLECTION = {
  type: "FeatureCollection",
  features: []
};

const HEALTHCARE_AMENITIES = new Set([
  "hospital",
  "clinic",
  "doctors",
  "dentist",
  "pharmacy",
  "healthcare"
]);
const SCHOOL_AMENITIES = new Set([
  "school",
  "college",
  "university",
  "kindergarten"
]);
const PARK_TYPES = new Set([
  "park",
  "playground",
  "garden",
  "recreation_ground"
]);
const TRANSIT_AMENITIES = new Set([
  "bus_station",
  "bus_stop",
  "station",
  "taxi",
  "ferry_terminal"
]);
const MARKET_SHOPS = new Set([
  "supermarket",
  "grocery",
  "convenience",
  "mall",
  "marketplace",
  "department_store"
]);

function normalizeFeatureCollection(data) {
  if (
    !data ||
    data.type !== "FeatureCollection" ||
    !Array.isArray(data.features)
  ) {
    return EMPTY_FEATURE_COLLECTION;
  }

  return data;
}

function normalizeTag(value) {
  return String(value ?? "").trim().toLowerCase();
}

function matchesCategory(properties, categoryKey) {
  const amenity = normalizeTag(properties?.amenity);
  const leisure = normalizeTag(properties?.leisure);
  const shop = normalizeTag(properties?.shop);

  if (categoryKey === "healthcare") {
    return HEALTHCARE_AMENITIES.has(amenity);
  }

  if (categoryKey === "schools") {
    return SCHOOL_AMENITIES.has(amenity);
  }

  if (categoryKey === "parks") {
    return PARK_TYPES.has(leisure);
  }

  if (categoryKey === "transit") {
    return TRANSIT_AMENITIES.has(amenity);
  }

  if (categoryKey === "markets") {
    return MARKET_SHOPS.has(shop);
  }

  return false;
}

function shouldDisplayFeature(feature, categoryFilters) {
  const activeCategories = Object.entries(categoryFilters)
    .filter(([, enabled]) => Boolean(enabled))
    .map(([key]) => key);

  if (activeCategories.length === 0) {
    return false;
  }

  return activeCategories.some((categoryKey) =>
    matchesCategory(feature.properties ?? {}, categoryKey)
  );
}

function buildAnalysisSummary(filteredFeatures, clickedPoint) {
  const summary = {
    hasAnalysis: true,
    totalPois: filteredFeatures.length,
    zoneCounts: { 5: 0, 10: 0, 15: 0 },
    categoryCounts: {
      healthcare: 0,
      schools: 0,
      parks: 0,
      transit: 0,
      markets: 0
    },
    clickedPoint
  };

  for (const feature of filteredFeatures) {
    const props = feature.properties ?? {};
    const zone = Number(props.zone_minutes);

    if (zone === 5 || zone === 10 || zone === 15) {
      summary.zoneCounts[zone] += 1;
    }

    if (matchesCategory(props, "healthcare")) summary.categoryCounts.healthcare += 1;
    if (matchesCategory(props, "schools")) summary.categoryCounts.schools += 1;
    if (matchesCategory(props, "parks")) summary.categoryCounts.parks += 1;
    if (matchesCategory(props, "transit")) summary.categoryCounts.transit += 1;
    if (matchesCategory(props, "markets")) summary.categoryCounts.markets += 1;
  }

  return summary;
}

function buildEmptySummary() {
  return {
    hasAnalysis: false,
    totalPois: 0,
    zoneCounts: { 5: 0, 10: 0, 15: 0 },
    categoryCounts: {
      healthcare: 0,
      schools: 0,
      parks: 0,
      transit: 0,
      markets: 0
    },
    clickedPoint: null
  };
}

function removeLayerIfExists(mapRef, id) {
  if (mapRef.getLayer(id)) {
    mapRef.removeLayer(id);
  }
}

function removeSourceIfExists(mapRef, id) {
  if (mapRef.getSource(id)) {
    mapRef.removeSource(id);
  }
}

function upsertGeoJsonSource(mapRef, id, data) {
  const existingSource = mapRef.getSource(id);

  if (existingSource) {
    existingSource.setData(data);
    return;
  }

  mapRef.addSource(id, {
    type: "geojson",
    data
  });
}

function collectCoordinatePairs(coordinates, output) {
  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    return;
  }

  const first = coordinates[0];
  if (
    Array.isArray(first) &&
    typeof first[0] === "number" &&
    typeof first[1] === "number"
  ) {
    for (const pair of coordinates) {
      output.push(pair);
    }

    return;
  }

  for (const nested of coordinates) {
    collectCoordinatePairs(nested, output);
  }
}

function fitMapToFifteenMinuteZone(mapRef, zonesFeatureCollection) {
  const features = zonesFeatureCollection?.features ?? [];
  if (features.length === 0) {
    return;
  }

  const fifteenMinuteFeature =
    features.find((feature) => Number(feature?.properties?.minutes) === 15) ??
    features[0];

  const geometry = fifteenMinuteFeature?.geometry;
  if (!geometry?.coordinates) {
    return;
  }

  const points = [];
  collectCoordinatePairs(geometry.coordinates, points);

  if (points.length === 0) {
    return;
  }

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  for (const [lng, lat] of points) {
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  }

  if (
    !Number.isFinite(minLng) ||
    !Number.isFinite(minLat) ||
    !Number.isFinite(maxLng) ||
    !Number.isFinite(maxLat)
  ) {
    return;
  }

  mapRef.fitBounds(
    [
      [minLng, minLat],
      [maxLng, maxLat]
    ],
    {
      padding: { top: 60, right: 60, bottom: 60, left: 380 },
      duration: 500,
      maxZoom: 14
    }
  );
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function usePoisLayer({ map, setLoading, categoryFilters, onSummaryChange }) {
  const rawReachablePoisRef = useRef(EMPTY_FEATURE_COLLECTION);
  const clickedPointRef = useRef(null);

  useEffect(() => {
    const mapRef = map.current;
    if (!mapRef) {
      return;
    }

    const filteredFeatures = rawReachablePoisRef.current.features.filter((feature) =>
      shouldDisplayFeature(feature, categoryFilters)
    );

    const filteredFeatureCollection = {
      type: "FeatureCollection",
      features: filteredFeatures
    };

    const existingSource = mapRef.getSource(REACHABLE_POIS_SOURCE_ID);
    if (existingSource) {
      existingSource.setData(filteredFeatureCollection);
    }

    if (rawReachablePoisRef.current.features.length === 0) {
      onSummaryChange(buildEmptySummary());
      return;
    }

    onSummaryChange(
      buildAnalysisSummary(filteredFeatures, clickedPointRef.current)
    );
  }, [map, categoryFilters, onSummaryChange]);

  function clearAnalysis() {
    const mapRef = map.current;
    if (!mapRef) {
      return;
    }

    for (const layer of ZONE_LAYERS) {
      removeLayerIfExists(mapRef, layer.lineId);
      removeLayerIfExists(mapRef, layer.fillId);
    }

    removeLayerIfExists(mapRef, REACHABLE_POIS_LAYER_ID);
    removeLayerIfExists(mapRef, CLICKED_POINT_LAYER_ID);

    removeSourceIfExists(mapRef, ANALYSIS_SOURCE_ID);
    removeSourceIfExists(mapRef, REACHABLE_POIS_SOURCE_ID);
    removeSourceIfExists(mapRef, CLICKED_POINT_SOURCE_ID);

    rawReachablePoisRef.current = EMPTY_FEATURE_COLLECTION;
    clickedPointRef.current = null;
    onSummaryChange(buildEmptySummary());
  }

  useEffect(() => {
    if (!map.current) {
      return;
    }

    const mapRef = map.current;

    async function runAnalysis(clickEvent) {
      setLoading(true);

      try {
        const clickedPoint = {
          lng: clickEvent.lngLat.lng,
          lat: clickEvent.lngLat.lat
        };
        clickedPointRef.current = clickedPoint;

        upsertGeoJsonSource(mapRef, CLICKED_POINT_SOURCE_ID, {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: {
                type: "Point",
                coordinates: [clickedPoint.lng, clickedPoint.lat]
              },
              properties: {}
            }
          ]
        });

        if (!mapRef.getLayer(CLICKED_POINT_LAYER_ID)) {
          mapRef.addLayer({
            id: CLICKED_POINT_LAYER_ID,
            type: "circle",
            source: CLICKED_POINT_SOURCE_ID,
            paint: {
              "circle-radius": 8,
              "circle-color": "#ef4444",
              "circle-stroke-width": 2,
              "circle-stroke-color": "#ffffff"
            }
          });
        }

        const response = await fetch(
          buildAnalysisUrl(clickedPoint.lng, clickedPoint.lat)
        );
        if (!response.ok) {
          throw new Error(`Analysis request failed (${response.status})`);
        }

        const payload = await response.json();
        const zonesGeojson = normalizeFeatureCollection(
          payload?.isochrones ?? payload?.isochrone
        );
        const reachablePoisGeojson = normalizeFeatureCollection(
          payload?.reachablePois
        );

        for (const layer of ZONE_LAYERS) {
          removeLayerIfExists(mapRef, layer.lineId);
          removeLayerIfExists(mapRef, layer.fillId);
        }
        removeSourceIfExists(mapRef, ANALYSIS_SOURCE_ID);

        upsertGeoJsonSource(mapRef, ANALYSIS_SOURCE_ID, zonesGeojson);

        // Draw from outer ring to inner ring to make the 5-minute core stand out.
        for (const zone of ZONE_LAYERS) {
          mapRef.addLayer({
            id: zone.fillId,
            type: "fill",
            source: ANALYSIS_SOURCE_ID,
            filter: ["==", ["get", "minutes"], zone.minutes],
            paint: {
              "fill-color": zone.fillColor,
              "fill-opacity": zone.fillOpacity
            }
          });

          mapRef.addLayer({
            id: zone.lineId,
            type: "line",
            source: ANALYSIS_SOURCE_ID,
            filter: ["==", ["get", "minutes"], zone.minutes],
            paint: {
              "line-color": zone.lineColor,
              "line-width": 1.4,
              "line-opacity": 0.9
            }
          });
        }

        rawReachablePoisRef.current = reachablePoisGeojson;

        const filteredPois = {
          type: "FeatureCollection",
          features: reachablePoisGeojson.features.filter((feature) =>
            shouldDisplayFeature(feature, categoryFilters)
          )
        };

        upsertGeoJsonSource(mapRef, REACHABLE_POIS_SOURCE_ID, filteredPois);
        if (!mapRef.getLayer(REACHABLE_POIS_LAYER_ID)) {
          mapRef.addLayer({
            id: REACHABLE_POIS_LAYER_ID,
            type: "circle",
            source: REACHABLE_POIS_SOURCE_ID,
            paint: {
              "circle-radius": 5.8,
              "circle-color": "#16a34a",
              "circle-stroke-width": 1.1,
              "circle-stroke-color": "#ffffff"
            }
          });
        }

        onSummaryChange(
          buildAnalysisSummary(filteredPois.features, clickedPointRef.current)
        );
        fitMapToFifteenMinuteZone(mapRef, zonesGeojson);
      } catch (error) {
        console.error("Analysis failed:", error);
      } finally {
        setLoading(false);
      }
    }

    function openPoiPopup(event, properties) {
      const name = escapeHtml(properties?.name ?? "Unknown");
      const amenity = escapeHtml(properties?.amenity ?? "-");
      const leisure = escapeHtml(properties?.leisure ?? "-");
      const shop = escapeHtml(properties?.shop ?? "-");
      const zone = escapeHtml(properties?.zone_minutes ?? "-");

      const popupContent = `
        <div style="font-family: system-ui; min-width: 190px;">
          <h3 style="margin: 0 0 6px; font-size: 14px;">${name}</h3>
          <p style="margin: 2px 0; font-size: 12px;">Amenity: ${amenity}</p>
          <p style="margin: 2px 0; font-size: 12px;">Leisure: ${leisure}</p>
          <p style="margin: 2px 0; font-size: 12px;">Shop: ${shop}</p>
          <p style="margin: 6px 0 0; font-size: 12px;"><strong>Zone: ${zone} min</strong></p>
        </div>
      `;

      new maplibregl.Popup({ closeButton: true, closeOnClick: true })
        .setLngLat(event.lngLat)
        .setHTML(popupContent)
        .addTo(mapRef);
    }

    function handleMapClick(event) {
      if (!mapRef.getLayer(REACHABLE_POIS_LAYER_ID)) {
        runAnalysis(event);
        return;
      }

      const poiFeatures = mapRef.queryRenderedFeatures(event.point, {
        layers: [REACHABLE_POIS_LAYER_ID]
      });

      if (poiFeatures.length > 0) {
        openPoiPopup(event, poiFeatures[0].properties ?? {});
        return;
      }

      runAnalysis(event);
    }

    function handleMouseMove(event) {
      if (!mapRef.getLayer(REACHABLE_POIS_LAYER_ID)) {
        mapRef.getCanvas().style.cursor = "";
        return;
      }

      const poiFeatures = mapRef.queryRenderedFeatures(event.point, {
        layers: [REACHABLE_POIS_LAYER_ID]
      });

      mapRef.getCanvas().style.cursor =
        poiFeatures.length > 0 ? "pointer" : "";
    }

    if (mapRef.isStyleLoaded()) {
      mapRef.on("click", handleMapClick);
      mapRef.on("mousemove", handleMouseMove);
    } else {
      mapRef.once("load", () => {
        mapRef.on("click", handleMapClick);
        mapRef.on("mousemove", handleMouseMove);
      });
    }

    return () => {
      mapRef.off("click", handleMapClick);
      mapRef.off("mousemove", handleMouseMove);
    };
  }, [map, setLoading, categoryFilters, onSummaryChange]);

  return {
    clearAnalysis
  };
}

export default usePoisLayer;
