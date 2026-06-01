import { useCallback, useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import LayerPanel from "./LayerPanel";
import LoadingOverlay from "./LoadingOverlay";
import { buildAnalysisUrl, getBoundary } from "../services/api";
import {
  POI_CATEGORY_CONFIG,
  getCategoryConfig,
  matchesCategory,
  resolveFeatureCategory
} from "../config/poiCategories";

const CATEGORY_KEYS = POI_CATEGORY_CONFIG.map((category) => category.key);
const DEFAULT_CATEGORY_FILTERS = Object.fromEntries(
  CATEGORY_KEYS.map((key) => [key, true])
);

const EMPTY_FEATURE_COLLECTION = {
  type: "FeatureCollection",
  features: []
};

const CLICKED_POINT_PANE = "clicked-point-pane";
const EMPTY_KPI_METRICS = {
  walkableAreaHa: 0,
  streetReachKm: 0,
  connectedNodes: 0
};

const ZONE_STYLES = {
  15: {
    color: "#cbd5e1",
    fillColor: "#4b5563",
    fillOpacity: 0.44,
    weight: 1.55,
    opacity: 0.96,
    dashArray: "7 5"
  },
  10: {
    color: "#f59e0b",
    fillColor: "#fef3c7",
    fillOpacity: 0.36,
    weight: 1.45,
    opacity: 0.92
  },
  5: {
    color: "#2e8b57",
    fillColor: "#2e8b57",
    fillOpacity: 0.34,
    weight: 1.55,
    opacity: 0.95
  }
};

const TILE_LAYER_CONFIG = {
  light: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    options: {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    }
  },
  dark: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    options: {
      subdomains: "abcd",
      maxZoom: 19,
      attribution:
        "&copy; OpenStreetMap contributors &copy; <a href='https://carto.com/attributions'>CARTO</a>"
    }
  }
};

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

function normalizeKpiMetrics(metadata) {
  const walkableAreaHa = Number(metadata?.walkableAreaHa);
  const streetReachKm = Number(metadata?.streetReachKm);
  const connectedNodes = Number(metadata?.connectedNodes);

  return {
    walkableAreaHa: Number.isFinite(walkableAreaHa) ? walkableAreaHa : 0,
    streetReachKm: Number.isFinite(streetReachKm) ? streetReachKm : 0,
    connectedNodes: Number.isFinite(connectedNodes) ? connectedNodes : 0
  };
}

function buildAnalysisSummary(allFeatures, filteredFeatures, clickedPoint, kpiMetrics) {
  const categoryCounts = Object.fromEntries(CATEGORY_KEYS.map((key) => [key, 0]));

  const summary = {
    hasAnalysis: true,
    totalPois: filteredFeatures.length,
    zoneCounts: { 5: 0, 10: 0, 15: 0 },
    categoryCounts,
    kpiMetrics,
    clickedPoint
  };

  for (const feature of filteredFeatures) {
    const props = feature.properties ?? {};
    const zone = Number(props.zone_minutes);

    if (zone === 5 || zone === 10 || zone === 15) {
      summary.zoneCounts[zone] += 1;
    }

    for (const categoryKey of CATEGORY_KEYS) {
      if (matchesCategory(props, categoryKey)) {
        summary.categoryCounts[categoryKey] += 1;
      }
    }
  }

  for (const feature of allFeatures) {
    const props = feature.properties ?? {};

    for (const categoryKey of CATEGORY_KEYS) {
      if (matchesCategory(props, categoryKey)) {
        summary.categoryCounts[categoryKey] += 1;
      }
    }
  }

  return summary;
}

function buildEmptySummary() {
  return {
    hasAnalysis: false,
    totalPois: 0,
    zoneCounts: { 5: 0, 10: 0, 15: 0 },
    categoryCounts: Object.fromEntries(CATEGORY_KEYS.map((key) => [key, 0])),
    kpiMetrics: { ...EMPTY_KPI_METRICS },
    clickedPoint: null
  };
}

function getBoundaryStyle(theme) {
  if (theme === "dark") {
    return {
      color: "#cbd5e1",
      weight: 1.2,
      opacity: 0.7,
      fillColor: "#1f2937",
      fillOpacity: 0.08
    };
  }

  return {
    color: "#475569",
    weight: 1.2,
    opacity: 0.7,
    fillColor: "#f8fafc",
    fillOpacity: 0.02
  };
}

function getLargestZoneFeature(zoneFeatures) {
  if (zoneFeatures.length === 0) {
    return null;
  }

  return zoneFeatures.reduce((largest, candidate) => {
    const largestMinutes = Number(largest?.properties?.minutes ?? 0);
    const candidateMinutes = Number(candidate?.properties?.minutes ?? 0);

    return candidateMinutes > largestMinutes ? candidate : largest;
  }, zoneFeatures[0]);
}

function getZoneFeatureByMinutes(zoneFeatures, minutes) {
  return (
    zoneFeatures.find(
      (feature) => Number(feature?.properties?.minutes ?? 0) === minutes
    ) ?? null
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

function MapView() {
  const [theme, setTheme] = useState(() => {
    const savedTheme = window.localStorage.getItem("walkability-theme");
    if (savedTheme === "light" || savedTheme === "dark") {
      return savedTheme;
    }

    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  });
  const [loading, setLoading] = useState(false);
  const [categoryFilters, setCategoryFilters] = useState(
    DEFAULT_CATEGORY_FILTERS
  );
  const [analysisSummary, setAnalysisSummary] = useState(buildEmptySummary);

  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const baseTileLayerRef = useRef(null);
  const themeRef = useRef(theme);

  const boundaryLayerRef = useRef(null);
  const zonesLayerRef = useRef(null);
  const poisLayerRef = useRef(null);
  const clickedPointLayerRef = useRef(null);

  const rawReachablePoisRef = useRef(EMPTY_FEATURE_COLLECTION);
  const kpiMetricsRef = useRef(EMPTY_KPI_METRICS);
  const clickedPointRef = useRef(null);
  const categoryFiltersRef = useRef(DEFAULT_CATEGORY_FILTERS);

  useEffect(() => {
    categoryFiltersRef.current = categoryFilters;
  }, [categoryFilters]);

  useEffect(() => {
    themeRef.current = theme;
    window.localStorage.setItem("walkability-theme", theme);
    document.body.dataset.theme = theme;
  }, [theme]);

  const renderPois = useCallback((features) => {
    if (!mapRef.current || !poisLayerRef.current) {
      return;
    }

    poisLayerRef.current.clearLayers();

    for (const feature of features) {
      const geometry = feature?.geometry;
      if (!geometry || geometry.type !== "Point") {
        continue;
      }

      const [lng, lat] = geometry.coordinates ?? [];
      if (typeof lat !== "number" || typeof lng !== "number") {
        continue;
      }

      const props = feature.properties ?? {};
      const categoryKey = resolveFeatureCategory(props);
      const category = getCategoryConfig(categoryKey);

      const popupHtml = `
        <div class="poi-tooltip-card">
          <h3 class="poi-tooltip-title">${escapeHtml(props.name ?? "Unknown")}</h3>
          <p class="poi-tooltip-line">Category: ${escapeHtml(category.label)}</p>
          <p class="poi-tooltip-line">Amenity: ${escapeHtml(props.amenity ?? "-")}</p>
          <p class="poi-tooltip-line">Leisure: ${escapeHtml(props.leisure ?? "-")}</p>
          <p class="poi-tooltip-line">Shop: ${escapeHtml(props.shop ?? "-")}</p>
          <p class="poi-tooltip-zone">Zone: ${escapeHtml(props.zone_minutes ?? "-")} min</p>
        </div>
      `;

      const marker = L.circleMarker([lat, lng], {
        radius: 6.2,
        fillColor: category.color,
        color: "#ffffff",
        weight: 1.4,
        fillOpacity: 0.95,
        bubblingMouseEvents: false
      });

      marker.bindTooltip(popupHtml, {
        direction: "top",
        offset: [0, -8],
        sticky: true,
        opacity: 1,
        className: "poi-hover-card"
      });

      marker.on("mouseover", () => marker.openTooltip());
      marker.on("mouseout", () => marker.closeTooltip());
      marker.on("click", (event) => {
        L.DomEvent.stopPropagation(event);
      });

      marker.addTo(poisLayerRef.current);
    }

    clickedPointLayerRef.current?.bringToFront?.();
  }, []);

  const applyCategoryFilter = useCallback(() => {
    const filteredFeatures = rawReachablePoisRef.current.features.filter((feature) =>
      shouldDisplayFeature(feature, categoryFiltersRef.current)
    );

    renderPois(filteredFeatures);

    if (rawReachablePoisRef.current.features.length === 0) {
      setAnalysisSummary(buildEmptySummary());
      return;
    }

    setAnalysisSummary(
      buildAnalysisSummary(
        rawReachablePoisRef.current.features,
        filteredFeatures,
        clickedPointRef.current,
        kpiMetricsRef.current
      )
    );
  }, [renderPois]);

  const clearAnalysis = useCallback(() => {
    zonesLayerRef.current?.clearLayers();
    poisLayerRef.current?.clearLayers();

    if (mapRef.current && clickedPointLayerRef.current) {
      mapRef.current.removeLayer(clickedPointLayerRef.current);
      clickedPointLayerRef.current = null;
    }

    rawReachablePoisRef.current = EMPTY_FEATURE_COLLECTION;
    kpiMetricsRef.current = EMPTY_KPI_METRICS;
    clickedPointRef.current = null;
    setAnalysisSummary(buildEmptySummary());
  }, []);

  useEffect(() => {
    applyCategoryFilter();
  }, [categoryFilters, applyCategoryFilter]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) {
      return;
    }

    const map = L.map(mapContainerRef.current, {
      zoomControl: false,
      preferCanvas: true
    }).setView([31.5204, 74.3587], 11);

    mapRef.current = map;
    const clickedPointPane = map.createPane(CLICKED_POINT_PANE);
    clickedPointPane.style.zIndex = "760";
    clickedPointPane.style.pointerEvents = "none";

    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.control.scale({ position: "bottomleft", imperial: false }).addTo(map);

    const initialTileConfig =
      TILE_LAYER_CONFIG[themeRef.current] ?? TILE_LAYER_CONFIG.light;
    baseTileLayerRef.current = L.tileLayer(
      initialTileConfig.url,
      initialTileConfig.options
    ).addTo(map);

    zonesLayerRef.current = L.layerGroup().addTo(map);
    poisLayerRef.current = L.layerGroup().addTo(map);

    async function drawBoundary() {
      try {
        const boundaryGeojson = await getBoundary();
        if (!mapRef.current) {
          return;
        }

        if (boundaryLayerRef.current) {
          mapRef.current.removeLayer(boundaryLayerRef.current);
        }

        boundaryLayerRef.current = L.geoJSON(boundaryGeojson, {
          style: getBoundaryStyle(themeRef.current)
        }).addTo(mapRef.current);

        const bounds = boundaryLayerRef.current.getBounds();
        if (bounds.isValid()) {
          mapRef.current.fitBounds(bounds, {
            paddingTopLeft: [360, 28],
            paddingBottomRight: [28, 28],
            maxZoom: 12
          });
        }
      } catch (error) {
        console.error("Failed to load Lahore boundary:", error);
      }
    }

    async function runAnalysis(lat, lng) {
      if (!mapRef.current) {
        return;
      }

      setLoading(true);

      try {
        clickedPointRef.current = { lat, lng };

        if (clickedPointLayerRef.current) {
          mapRef.current.removeLayer(clickedPointLayerRef.current);
        }

        clickedPointLayerRef.current = L.circleMarker([lat, lng], {
          radius: 8,
          fillColor: "#ef4444",
          color: "#ffffff",
          weight: 2,
          fillOpacity: 1,
          pane: CLICKED_POINT_PANE
        }).addTo(mapRef.current);
        clickedPointLayerRef.current.bringToFront();

        const response = await fetch(buildAnalysisUrl(lng, lat));
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

        zonesLayerRef.current?.clearLayers();

        const sortedZones = [...zonesGeojson.features].sort(
          (a, b) =>
            Number(b?.properties?.minutes ?? 0) -
            Number(a?.properties?.minutes ?? 0)
        );

        for (const zoneFeature of sortedZones) {
          const minutes = Number(zoneFeature?.properties?.minutes ?? 0);
          const zoneStyle = ZONE_STYLES[minutes] ?? ZONE_STYLES[15];

          L.geoJSON(zoneFeature, {
            style: {
              color: zoneStyle.color,
              weight: zoneStyle.weight ?? 1.4,
              opacity: zoneStyle.opacity ?? 0.9,
              fillColor: zoneStyle.fillColor,
              fillOpacity: zoneStyle.fillOpacity,
              dashArray: zoneStyle.dashArray ?? null
            },
            interactive: false
          }).addTo(zonesLayerRef.current);
        }

        clickedPointLayerRef.current?.bringToFront?.();

        const fitZoneFeature =
          getZoneFeatureByMinutes(sortedZones, 15) ??
          getLargestZoneFeature(sortedZones);

        if (fitZoneFeature) {
          const fitLayer = L.geoJSON(fitZoneFeature);
          const bounds = fitLayer.getBounds();

          if (bounds.isValid()) {
            mapRef.current.fitBounds(bounds, {
              paddingTopLeft: [360, 40],
              paddingBottomRight: [40, 40]
            });
          }
        }

        rawReachablePoisRef.current = reachablePoisGeojson;
        kpiMetricsRef.current = normalizeKpiMetrics(payload?.metadata);
        applyCategoryFilter();
      } catch (error) {
        console.error("Analysis failed:", error);
      } finally {
        setLoading(false);
      }
    }

    function handleMapClick(event) {
      runAnalysis(event.latlng.lat, event.latlng.lng);
    }

    map.on("click", handleMapClick);
    drawBoundary();

    return () => {
      map.off("click", handleMapClick);
      map.remove();
      mapRef.current = null;
    };
  }, [applyCategoryFilter]);

  useEffect(() => {
    if (!mapRef.current) {
      return;
    }

    const tileConfig = TILE_LAYER_CONFIG[theme] ?? TILE_LAYER_CONFIG.light;

    if (baseTileLayerRef.current) {
      mapRef.current.removeLayer(baseTileLayerRef.current);
    }

    baseTileLayerRef.current = L.tileLayer(tileConfig.url, tileConfig.options).addTo(
      mapRef.current
    );

    if (boundaryLayerRef.current) {
      boundaryLayerRef.current.setStyle(getBoundaryStyle(theme));
    }
  }, [theme]);

  function toggleCategory(categoryKey) {
    setCategoryFilters((previous) => ({
      ...previous,
      [categoryKey]: !previous[categoryKey]
    }));
  }

  function resetFilters() {
    setCategoryFilters(DEFAULT_CATEGORY_FILTERS);
  }

  function toggleTheme() {
    setTheme((previous) => (previous === "light" ? "dark" : "light"));
  }

  return (
    <div className={`map-shell theme-${theme}`}>
      <div ref={mapContainerRef} className="map-canvas" />

      <LayerPanel
        theme={theme}
        onToggleTheme={toggleTheme}
        categoryFilters={categoryFilters}
        onToggleCategory={toggleCategory}
        onResetFilters={resetFilters}
        onClearAnalysis={clearAnalysis}
        analysisSummary={analysisSummary}
      />

      <LoadingOverlay loading={loading} />
    </div>
  );
}

export default MapView;
