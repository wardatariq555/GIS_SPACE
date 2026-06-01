import { POI_CATEGORY_CONFIG } from "../config/poiCategories";

function formatKpiNumber(value, fractionDigits = 1) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return "0";
  }

  return numericValue.toLocaleString(undefined, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits
  });
}

function formatPercent(part, total) {
  if (total <= 0) {
    return "0%";
  }

  const percent = (part / total) * 100;
  const digits = percent >= 10 ? 1 : 2;

  return `${percent.toFixed(digits)}%`;
}

function LayerPanel({
  theme,
  onToggleTheme,
  categoryFilters,
  onToggleCategory,
  onResetFilters,
  onClearAnalysis,
  analysisSummary
}) {
  const {
    hasAnalysis,
    totalPois,
    zoneCounts,
    categoryCounts,
    kpiMetrics,
    clickedPoint
  } = analysisSummary;

  const compositionRows = POI_CATEGORY_CONFIG.map((category) => ({
    ...category,
    count: categoryCounts?.[category.key] ?? 0
  }));
  const compositionTotal = compositionRows.reduce(
    (total, row) => total + row.count,
    0
  );
  const walkableAreaSqKm = Number(kpiMetrics?.walkableAreaHa ?? 0) / 100;

  return (
    <aside className="layer-panel">
      <div className="panel-header">
        <div className="panel-header-row">
          <h1 className="panel-title">15-Minute Walkability</h1>
          <button
            type="button"
            className="theme-toggle-button"
            onClick={onToggleTheme}
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
            title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
          >
            {theme === "light" ? "Dark Mode" : "Light Mode"}
          </button>
        </div>
        <p className="panel-subtitle">
          Click on the map to generate 5, 10, and 15 minute walking zones.
        </p>
      </div>

      <section className="panel-section">
        <h2 className="section-title">Travel Time Zones</h2>
        <div className="legend-list">
          <div className="legend-item">
            <span className="legend-swatch zone-5" />
            <span>5 min walk</span>
          </div>
          <div className="legend-item">
            <span className="legend-swatch zone-10" />
            <span>10 min walk</span>
          </div>
          <div className="legend-item">
            <span className="legend-swatch zone-15" />
            <span>15 min walk</span>
          </div>
          <div className="legend-item">
            <span className="legend-swatch poi" />
            <span>Reachable POIs</span>
          </div>
        </div>
      </section>

      <section className="panel-section">
        <h2 className="section-title">Walkability Metrics</h2>

        {hasAnalysis ? (
          <div className="kpi-grid">
            <article className="kpi-card">
              <p className="kpi-label">Walkable Area</p>
              <p className="kpi-value">
                {formatKpiNumber(walkableAreaSqKm, 2)}
                <span className="kpi-unit"> km</span>
              </p>
              <p className="kpi-subtitle">15-min footprint</p>
            </article>
            <article className="kpi-card">
              <p className="kpi-label">Street Reach</p>
              <p className="kpi-value">
                {formatKpiNumber(kpiMetrics?.streetReachKm, 1)}
                <span className="kpi-unit"> km</span>
              </p>
              <p className="kpi-subtitle">Reachable network</p>
            </article>
            <article className="kpi-card">
              <p className="kpi-label">Junctions</p>
              <p className="kpi-value">
                {Math.max(0, Math.round(Number(kpiMetrics?.connectedNodes ?? 0))).toLocaleString()}
              </p>
              <p className="kpi-subtitle">Connected nodes</p>
            </article>
          </div>
        ) : (
          <p className="empty-state">
            Metrics will appear after you run an analysis.
          </p>
        )}
      </section>

      <section className="panel-section">
        <h2 className="section-title">POI Categories</h2>
        <div className="toggle-grid">
          {POI_CATEGORY_CONFIG.map((category) => {
            const isActive = Boolean(categoryFilters[category.key]);

            return (
              <button
                key={category.key}
                type="button"
                className={`toggle-chip ${isActive ? "active" : ""}`}
                style={{ "--chip-color": category.color }}
                onClick={() => onToggleCategory(category.key)}
                aria-pressed={isActive}
              >
                <span className="toggle-indicator" aria-hidden="true">
                  {category.symbol}
                </span>
                {category.label}
              </button>
            );
          })}
        </div>
      </section>

      <section className="panel-section">
        <h2 className="section-title">Land-Use Composition</h2>

        {hasAnalysis ? (
          <div className="composition-block">
            <div className="composition-stack" role="img" aria-label="Land-use composition">
              {compositionRows.map((row) => {
                const widthPercent =
                  compositionTotal > 0 ? (row.count / compositionTotal) * 100 : 0;

                return (
                  <span
                    key={row.key}
                    className="composition-segment"
                    style={{
                      width: `${widthPercent}%`,
                      "--segment-color": row.color
                    }}
                  />
                );
              })}
            </div>

            <div className="composition-list">
              {compositionRows.map((row) => (
                <div key={row.key} className="composition-row">
                  <div className="composition-name">
                    <span
                      className="composition-dot"
                      style={{ "--segment-color": row.color }}
                    />
                    <span>{row.label}</span>
                  </div>
                  <div className="composition-values">
                    <strong>{row.count}</strong>
                    <span>{formatPercent(row.count, compositionTotal)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="empty-state">
            Composition will appear after you run an analysis.
          </p>
        )}
      </section>

      <section className="panel-section">
        <h2 className="section-title">Result Summary</h2>

        {hasAnalysis ? (
          <div className="summary-grid">
            <div className="summary-row">
              <span className="summary-label">Reachable POIs</span>
              <strong className="summary-value">{totalPois}</strong>
            </div>
            <div className="summary-row">
              <span className="summary-label">5 min zone</span>
              <strong className="summary-value">{zoneCounts[5] ?? 0}</strong>
            </div>
            <div className="summary-row">
              <span className="summary-label">10 min zone</span>
              <strong className="summary-value">{zoneCounts[10] ?? 0}</strong>
            </div>
            <div className="summary-row">
              <span className="summary-label">15 min zone</span>
              <strong className="summary-value">{zoneCounts[15] ?? 0}</strong>
            </div>
            {clickedPoint && (
              <p className="point-readout">
                Center: {clickedPoint.lat.toFixed(5)}, {clickedPoint.lng.toFixed(5)}
              </p>
            )}
          </div>
        ) : (
          <p className="empty-state">
            No analysis yet. Click anywhere inside Lahore to start.
          </p>
        )}
      </section>

      <div className="panel-actions">
        <button type="button" className="action-button" onClick={onResetFilters}>
          Reset Filters
        </button>
        <button
          type="button"
          className="action-button secondary"
          onClick={onClearAnalysis}
        >
          Clear Map
        </button>
      </div>
    </aside>
  );
}

export default LayerPanel;
