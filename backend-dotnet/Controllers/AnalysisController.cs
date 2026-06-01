using Microsoft.AspNetCore.Mvc;
using Npgsql;
using System.Text.Json;

namespace backend_dotnet.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class AnalysisController : ControllerBase
    {
        private const string FallbackConnectionString =
            "Host=localhost;Port=5432;Database=lahore_15min_city;Username=postgres;Password=postgres";

        private const string EmptyFeatureCollectionJson =
            "{\"type\":\"FeatureCollection\",\"features\":[]}";

        private readonly string _connectionString;
        private readonly ILogger<AnalysisController> _logger;
        private static readonly SemaphoreSlim RoutingSetupLock = new(1, 1);
        private static bool _routingReady;

        public AnalysisController(
            IConfiguration configuration,
            ILogger<AnalysisController> logger
        )
        {
            _connectionString =
                configuration.GetConnectionString("DefaultConnection")
                ?? FallbackConnectionString;

            _logger = logger;
        }

        [HttpGet]
        public async Task<IActionResult> Get(
            double lng,
            double lat,
            double walkingSpeedMetersPerMinute = 80,
            double edgeBufferMeters = 14,
            double routeCarveBufferMeters = 5.0
        )
        {
            if (
                walkingSpeedMetersPerMinute <= 0 ||
                edgeBufferMeters <= 0 ||
                routeCarveBufferMeters <= 0
            )
            {
                return BadRequest(
                    "walkingSpeedMetersPerMinute, edgeBufferMeters, and routeCarveBufferMeters must be greater than zero."
                );
            }

            const double zone15Minutes = 15;

            var maxDistanceMeters =
                zone15Minutes * walkingSpeedMetersPerMinute;

            await using var conn =
                new NpgsqlConnection(_connectionString);

            await conn.OpenAsync();

            try
            {
                await EnsureRoutingReadyAsync(conn);

                await using var cmd =
                    new NpgsqlCommand(AnalysisSql, conn);
                cmd.CommandTimeout = 120;

                cmd.Parameters.AddWithValue("lng", lng);
                cmd.Parameters.AddWithValue("lat", lat);
                cmd.Parameters.AddWithValue("walking_speed_m_per_min", walkingSpeedMetersPerMinute);
                cmd.Parameters.AddWithValue("max_distance_m", maxDistanceMeters);
                cmd.Parameters.AddWithValue("edge_buffer_m", edgeBufferMeters);
                cmd.Parameters.AddWithValue("route_carve_buffer_m", routeCarveBufferMeters);

                await using var reader =
                    await cmd.ExecuteReaderAsync();

                if (!await reader.ReadAsync())
                {
                    return StatusCode(500, new
                    {
                        message = "Analysis query returned no rows."
                    });
                }

                var isochroneGeojson =
                    reader["isochrone_geojson"]?.ToString()
                    ?? EmptyFeatureCollectionJson;

                var isochronesGeojson =
                    reader["isochrones_geojson"]?.ToString()
                    ?? EmptyFeatureCollectionJson;

                var reachablePoisGeojson =
                    reader["reachable_pois_geojson"]?.ToString()
                    ?? EmptyFeatureCollectionJson;

                var walkableAreaHa =
                    reader["walkable_area_ha"] is DBNull
                        ? 0.0
                        : Convert.ToDouble(reader["walkable_area_ha"]);
                var streetReachKm =
                    reader["street_reach_km"] is DBNull
                        ? 0.0
                        : Convert.ToDouble(reader["street_reach_km"]);
                var connectedNodes =
                    reader["connected_nodes"] is DBNull
                        ? 0
                        : Convert.ToInt32(reader["connected_nodes"]);

                long? nearestNode = null;
                if (reader["nearest_node"] is long node)
                {
                    nearestNode = node;
                }

                using var isochroneDoc =
                    JsonDocument.Parse(isochroneGeojson);

                using var isochronesDoc =
                    JsonDocument.Parse(isochronesGeojson);

                using var reachablePoisDoc =
                    JsonDocument.Parse(reachablePoisGeojson);

                return Ok(new
                {
                    isochrones = isochronesDoc.RootElement.Clone(),
                    isochrone = isochroneDoc.RootElement.Clone(),
                    reachablePois = reachablePoisDoc.RootElement.Clone(),
                    metadata = new
                    {
                        zoneMinutes = new[] { 5, 10, 15 },
                        walkingSpeedMetersPerMinute,
                        maxDistanceMeters,
                        routeCarveBufferMeters,
                        walkableAreaHa,
                        streetReachKm,
                        connectedNodes,
                        nearestNode
                    }
                });
            }
            catch (PostgresException ex)
            {
                _logger.LogError(ex, "Spatial analysis failed.");

                return StatusCode(500, new
                {
                    message =
                        "Spatial analysis failed. Ensure PostGIS + pgRouting are installed and graph tables are loaded.",
                    error = ex.MessageText
                });
            }
        }

        private static async Task EnsureRoutingReadyAsync(
            NpgsqlConnection conn
        )
        {
            if (_routingReady)
            {
                return;
            }

            await RoutingSetupLock.WaitAsync();

            try
            {
                if (_routingReady)
                {
                    return;
                }

                await using var cmd =
                    new NpgsqlCommand(EnsureRoutingSql, conn);

                await cmd.ExecuteNonQueryAsync();

                _routingReady = true;
            }
            finally
            {
                RoutingSetupLock.Release();
            }
        }

        private const string EnsureRoutingSql =
            """
            CREATE EXTENSION IF NOT EXISTS postgis;
            CREATE EXTENSION IF NOT EXISTS pgrouting;

            CREATE INDEX IF NOT EXISTS walk_nodes_geom_gix
                ON walk_nodes USING GIST (geometry);
            CREATE INDEX IF NOT EXISTS walk_nodes_osmid_idx
                ON walk_nodes (osmid);

            CREATE INDEX IF NOT EXISTS walk_edges_u_idx
                ON walk_edges (u);
            CREATE INDEX IF NOT EXISTS walk_edges_v_idx
                ON walk_edges (v);
            CREATE INDEX IF NOT EXISTS walk_edges_geom_gix
                ON walk_edges USING GIST (geometry);

            CREATE INDEX IF NOT EXISTS lahore_pois_geom_gix
                ON lahore_pois USING GIST (geometry);

            CREATE TABLE IF NOT EXISTS walk_edges_routing (
                id BIGSERIAL PRIMARY KEY,
                source BIGINT NOT NULL,
                target BIGINT NOT NULL,
                cost DOUBLE PRECISION NOT NULL,
                reverse_cost DOUBLE PRECISION NOT NULL,
                geom geometry(LineString, 4326) NOT NULL,
                road_class TEXT,
                lanes_tag TEXT,
                width_tag TEXT
            );

            ALTER TABLE walk_edges_routing
                ADD COLUMN IF NOT EXISTS road_class TEXT;
            ALTER TABLE walk_edges_routing
                ADD COLUMN IF NOT EXISTS lanes_tag TEXT;
            ALTER TABLE walk_edges_routing
                ADD COLUMN IF NOT EXISTS width_tag TEXT;

            INSERT INTO walk_edges_routing (
                source,
                target,
                cost,
                reverse_cost,
                geom,
                road_class,
                lanes_tag,
                width_tag
            )
            SELECT
                e.u::BIGINT,
                e.v::BIGINT,
                COALESCE(e.length, ST_Length(e.geometry::geography)),
                COALESCE(e.length, ST_Length(e.geometry::geography)),
                e.geometry,
                e.highway::TEXT,
                e.lanes::TEXT,
                e.width::TEXT
            FROM walk_edges e
            WHERE NOT EXISTS (
                SELECT 1 FROM walk_edges_routing LIMIT 1
            );

            UPDATE walk_edges_routing wr
            SET (road_class, lanes_tag, width_tag) = (
                SELECT
                    e.highway::TEXT,
                    e.lanes::TEXT,
                    e.width::TEXT
                FROM walk_edges e
                WHERE e.u::BIGINT = wr.source
                  AND e.v::BIGINT = wr.target
                ORDER BY e.geometry <-> wr.geom
                LIMIT 1
            )
            WHERE wr.road_class IS NULL
               OR wr.lanes_tag IS NULL
               OR wr.width_tag IS NULL;

            CREATE INDEX IF NOT EXISTS walk_edges_routing_source_idx
                ON walk_edges_routing (source);
            CREATE INDEX IF NOT EXISTS walk_edges_routing_target_idx
                ON walk_edges_routing (target);
            CREATE INDEX IF NOT EXISTS walk_edges_routing_geom_gix
                ON walk_edges_routing USING GIST (geom);
            """;

        private const string AnalysisSql =
            """
            WITH inputs AS (
                SELECT
                    ST_SetSRID(ST_MakePoint(@lng, @lat), 4326) AS click_geom,
                    @walking_speed_m_per_min::DOUBLE PRECISION AS speed_m_per_min,
                    @max_distance_m::DOUBLE PRECISION AS max_distance_m,
                    @edge_buffer_m::DOUBLE PRECISION AS edge_buffer_m,
                    @route_carve_buffer_m::DOUBLE PRECISION AS route_carve_buffer_m
            ),
            thresholds AS (
                SELECT
                    5::INT AS minutes,
                    5 * (SELECT speed_m_per_min FROM inputs) AS max_distance_m
                UNION ALL
                SELECT
                    10::INT AS minutes,
                    10 * (SELECT speed_m_per_min FROM inputs) AS max_distance_m
                UNION ALL
                SELECT
                    15::INT AS minutes,
                    15 * (SELECT speed_m_per_min FROM inputs) AS max_distance_m
            ),
            start_node AS (
                SELECT wn.osmid::BIGINT AS osmid
                FROM inputs i
                JOIN LATERAL (
                    SELECT osmid
                    FROM walk_nodes
                    ORDER BY geometry <-> i.click_geom
                    LIMIT 1
                ) wn ON true
            ),
            driving_distance_raw AS (
                SELECT
                    dd.node::BIGINT AS node_id,
                    dd.pred::BIGINT AS pred_node_id,
                    dd.edge::BIGINT AS edge_id,
                    dd.cost::DOUBLE PRECISION AS edge_cost_m,
                    dd.agg_cost::DOUBLE PRECISION AS agg_cost_m
                FROM start_node sn
                JOIN LATERAL pgr_drivingDistance(
                    'SELECT id, source, target, cost, reverse_cost FROM walk_edges_routing',
                    sn.osmid,
                    (SELECT MAX(max_distance_m) FROM thresholds),
                    directed := false
                ) dd ON true
            ),
            tree_edges AS (
                SELECT DISTINCT ON (ddr.edge_id, ddr.pred_node_id, ddr.node_id)
                    ddr.edge_id,
                    ddr.pred_node_id,
                    ddr.node_id,
                    ddr.edge_cost_m,
                    ddr.agg_cost_m,
                    (ddr.agg_cost_m - ddr.edge_cost_m) AS pred_agg_cost_m
                FROM driving_distance_raw ddr
                WHERE ddr.edge_id IS NOT NULL
                  AND ddr.edge_id <> -1
                  AND ddr.edge_cost_m > 0
                ORDER BY ddr.edge_id, ddr.pred_node_id, ddr.node_id, ddr.agg_cost_m
            ),
            zone_edge_segments_raw AS (
                SELECT
                    th.minutes,
                    te.edge_id,
                    CASE
                        WHEN te.agg_cost_m <= th.max_distance_m
                            THEN e.geom
                        WHEN te.pred_agg_cost_m < th.max_distance_m
                            THEN CASE
                                WHEN e.source = te.pred_node_id
                                 AND e.target = te.node_id
                                    THEN ST_LineSubstring(
                                        e.geom,
                                        0.0,
                                        GREATEST(
                                            0.0,
                                            LEAST(
                                                1.0,
                                                (th.max_distance_m - te.pred_agg_cost_m)
                                                / NULLIF(te.edge_cost_m, 0.0)
                                            )
                                        )
                                    )
                                WHEN e.target = te.pred_node_id
                                 AND e.source = te.node_id
                                    THEN ST_LineSubstring(
                                        e.geom,
                                        GREATEST(
                                            0.0,
                                            1.0 - LEAST(
                                                1.0,
                                                (th.max_distance_m - te.pred_agg_cost_m)
                                                / NULLIF(te.edge_cost_m, 0.0)
                                            )
                                        ),
                                        1.0
                                    )
                                ELSE NULL
                            END
                        ELSE NULL
                    END AS geom
                FROM thresholds th
                JOIN tree_edges te
                    ON te.pred_agg_cost_m < th.max_distance_m
                JOIN walk_edges_routing e
                    ON e.id = te.edge_id
            ),
            zone_edge_segments AS (
                SELECT
                    minutes,
                    edge_id,
                    ST_LineMerge(
                        ST_CollectionExtract(
                            ST_MakeValid(geom),
                            2
                        )
                    ) AS geom
                FROM zone_edge_segments_raw
                WHERE geom IS NOT NULL
                  AND NOT ST_IsEmpty(geom)
            ),
            zone_polygons_buffered AS (
                SELECT
                    zes.minutes,
                    CASE
                        WHEN COUNT(*) = 0
                            THEN NULL
                        ELSE
                            ST_CollectionExtract(
                                ST_MakeValid(
                                    ST_Transform(
                                        ST_Buffer(
                                            ST_SimplifyPreserveTopology(
                                                ST_Transform(
                                                    ST_UnaryUnion(ST_Collect(zes.geom)),
                                                    3857
                                                ),
                                                1.5
                                            ),
                                            (SELECT edge_buffer_m * 0.95 FROM inputs),
                                            'endcap=round join=round'
                                        ),
                                        4326
                                    )
                                ),
                                3
                            )
                    END AS geom
                FROM zone_edge_segments zes
                GROUP BY zes.minutes
            ),
            zone_terminal_nodes AS (
                SELECT DISTINCT
                    th.minutes,
                    wn.geometry AS geom
                FROM thresholds th
                JOIN driving_distance_raw ddr
                    ON ddr.agg_cost_m <= th.max_distance_m
                JOIN walk_nodes wn
                    ON wn.osmid::BIGINT = ddr.node_id
                WHERE ddr.node_id IS NOT NULL
                  AND ddr.node_id <> -1
            ),
            zone_hull_polygons_raw AS (
                SELECT
                    ztn.minutes,
                    CASE
                        WHEN COUNT(*) < 3
                            THEN NULL
                        ELSE
                            ST_ConcaveHull(
                                ST_Collect(ztn.geom),
                                0.62,
                                false
                            )
                    END AS geom
                FROM zone_terminal_nodes ztn
                GROUP BY ztn.minutes
            ),
            zone_hull_polygons AS (
                SELECT
                    zhpr.minutes,
                    ST_CollectionExtract(
                        ST_MakeValid(
                            CASE
                                WHEN zhpr.geom IS NULL OR ST_IsEmpty(zhpr.geom)
                                    THEN NULL
                                WHEN ST_GeometryType(zhpr.geom) IN ('ST_Polygon', 'ST_MultiPolygon')
                                    THEN zhpr.geom
                                ELSE
                                    ST_Transform(
                                        ST_Buffer(
                                            ST_Transform(zhpr.geom, 3857),
                                            GREATEST(
                                                (SELECT edge_buffer_m * 1.2 FROM inputs),
                                                6.0
                                            ),
                                            'endcap=round join=round'
                                        ),
                                        4326
                                    )
                            END
                        ),
                        3
                    ) AS geom
                FROM zone_hull_polygons_raw zhpr
            ),
            zone_base_polygons AS (
                SELECT
                    th.minutes,
                    CASE
                        WHEN zhp.geom IS NOT NULL AND NOT ST_IsEmpty(zhp.geom)
                            THEN zhp.geom
                        ELSE zpb.geom
                    END AS geom
                FROM thresholds th
                LEFT JOIN zone_hull_polygons zhp
                    ON zhp.minutes = th.minutes
                LEFT JOIN zone_polygons_buffered zpb
                    ON zpb.minutes = th.minutes
            ),
            zone_road_buffer_inputs AS (
                SELECT
                    zes.minutes,
                    zes.edge_id,
                    zes.geom,
                    wr.road_class,
                    wr.lanes_tag,
                    wr.width_tag
                FROM zone_edge_segments zes
                JOIN walk_edges_routing wr
                    ON wr.id = zes.edge_id
                WHERE zes.minutes = 15
                  AND zes.geom IS NOT NULL
                  AND NOT ST_IsEmpty(zes.geom)
            ),
            zone_road_buffer_metrics AS (
                SELECT
                    zrbi.minutes,
                    zrbi.geom,
                    COALESCE(
                        substring(
                            lower(COALESCE(zrbi.road_class, ''))
                            FROM '(motorway|trunk_link|trunk|primary_link|primary|secondary_link|secondary|tertiary_link|tertiary|residential|unclassified|service|living_street|pedestrian|footway|path|track|cycleway|steps|road)'
                        ),
                        'road'
                    ) AS road_class_norm,
                    NULLIF(
                        substring(
                            replace(lower(COALESCE(zrbi.width_tag, '')), ',', '.')
                            FROM '([0-9]+(\\.[0-9]+)?)'
                        ),
                        ''
                    )::DOUBLE PRECISION AS width_tag_m,
                    NULLIF(
                        substring(
                            replace(lower(COALESCE(zrbi.lanes_tag, '')), ',', '.')
                            FROM '([0-9]+(\\.[0-9]+)?)'
                        ),
                        ''
                    )::DOUBLE PRECISION AS lane_count
                FROM zone_road_buffer_inputs zrbi
            ),
            zone_road_corridor_segments AS (
                SELECT
                    zrbm.minutes,
                    ST_CollectionExtract(
                        ST_MakeValid(
                            ST_Transform(
                                ST_Buffer(
                                    ST_Transform(zrbm.geom, 3857),
                                    CASE
                                        WHEN zrbm.width_tag_m IS NOT NULL
                                            THEN GREATEST(
                                                (SELECT route_carve_buffer_m * 0.65 FROM inputs),
                                                LEAST(16.0, zrbm.width_tag_m * 0.5)
                                            )
                                        WHEN zrbm.lane_count IS NOT NULL
                                            THEN GREATEST(
                                                (SELECT route_carve_buffer_m * 0.75 FROM inputs),
                                                LEAST(15.0, zrbm.lane_count * 1.55)
                                            )
                                        WHEN zrbm.road_class_norm IN ('motorway', 'trunk', 'trunk_link', 'primary', 'primary_link')
                                            THEN GREATEST((SELECT route_carve_buffer_m * 1.8 FROM inputs), 9.0)
                                        WHEN zrbm.road_class_norm IN ('secondary', 'secondary_link', 'tertiary', 'tertiary_link')
                                            THEN GREATEST((SELECT route_carve_buffer_m * 1.2 FROM inputs), 6.5)
                                        ELSE GREATEST((SELECT route_carve_buffer_m * 0.85 FROM inputs), 4.5)
                                    END,
                                    'endcap=round join=round'
                                ),
                                4326
                            )
                        ),
                        3
                    ) AS geom
                FROM zone_road_buffer_metrics zrbm
            ),
            zone_road_corridors AS (
                SELECT
                    15::INT AS minutes,
                    ST_CollectionExtract(
                        ST_MakeValid(
                            ST_UnaryUnion(ST_Collect(zrcs.geom))
                        ),
                        3
                    ) AS geom
                FROM zone_road_corridor_segments zrcs
            ),
            zone_polygons_carved AS (
                SELECT
                    zbp.minutes,
                    CASE
                        WHEN zbp.geom IS NULL OR ST_IsEmpty(zbp.geom)
                            THEN NULL
                        WHEN zrc.geom IS NULL OR ST_IsEmpty(zrc.geom)
                            THEN zbp.geom
                        ELSE
                            ST_CollectionExtract(
                                ST_MakeValid(
                                    ST_Difference(
                                        zbp.geom,
                                        zrc.geom
                                    )
                                ),
                                3
                            )
                    END AS geom
                FROM zone_base_polygons zbp
                LEFT JOIN zone_road_corridors zrc
                    ON zrc.minutes = 15
            ),
            zone_polygon_area_metrics AS (
                SELECT
                    zbp.minutes,
                    zbp.geom AS base_geom,
                    zpc.geom AS carved_geom,
                    ST_Area(ST_Transform(zbp.geom, 3857)) AS base_area_m2,
                    CASE
                        WHEN zpc.geom IS NULL OR ST_IsEmpty(zpc.geom)
                            THEN NULL
                        ELSE ST_Area(ST_Transform(zpc.geom, 3857))
                    END AS carved_area_m2
                FROM zone_base_polygons zbp
                LEFT JOIN zone_polygons_carved zpc
                    ON zpc.minutes = zbp.minutes
                WHERE zbp.geom IS NOT NULL
                  AND NOT ST_IsEmpty(zbp.geom)
            ),
            zone_polygons_final AS (
                SELECT
                    zpam.minutes,
                    CASE
                        WHEN zpam.carved_geom IS NULL OR ST_IsEmpty(zpam.carved_geom)
                            THEN zpam.base_geom
                        WHEN zpam.base_area_m2 <= 0
                            THEN zpam.base_geom
                        WHEN (zpam.carved_area_m2 / NULLIF(zpam.base_area_m2, 0.0)) < 0.45
                            THEN zpam.base_geom
                        ELSE zpam.carved_geom
                    END AS geom
                FROM zone_polygon_area_metrics zpam
            ),
            isochrones_geojson AS (
                SELECT json_build_object(
                    'type', 'FeatureCollection',
                    'features',
                    COALESCE(
                        json_agg(
                            json_build_object(
                                'type', 'Feature',
                                'geometry', ST_AsGeoJSON(z.geom)::json,
                                'properties', json_build_object(
                                    'minutes', z.minutes,
                                    'label', z.minutes || ' min walk'
                                )
                            )
                            ORDER BY z.minutes DESC
                        ),
                        '[]'::json
                    )
                ) AS geojson
                FROM zone_polygons_final z
            ),
            isochrone_15_geojson AS (
                SELECT json_build_object(
                    'type', 'FeatureCollection',
                    'features',
                    COALESCE(
                        json_agg(
                            json_build_object(
                                'type', 'Feature',
                                'geometry', ST_AsGeoJSON(z.geom)::json,
                                'properties', json_build_object(
                                    'minutes', z.minutes,
                                    'label', z.minutes || ' min walk'
                                )
                            )
                        ),
                        '[]'::json
                    )
                ) AS geojson
                FROM zone_polygons_final z
                WHERE z.minutes = 15
            ),
            poi_points AS (
                SELECT
                    p.*,
                    ST_PointOnSurface(p.geometry) AS point_geom
                FROM lahore_pois p
            ),
            poi_points_within_15 AS (
                SELECT
                    pp.*
                FROM poi_points pp
                JOIN zone_polygons_final z15
                    ON z15.minutes = 15
                   AND (
                        ST_Covers(z15.geom, pp.point_geom)
                        OR ST_DWithin(
                            z15.geom,
                            pp.point_geom,
                            0.00008
                        )
                   )
            ),
            pois_with_zone AS (
                SELECT
                    pp.point_geom,
                    pp.name,
                    pp.amenity,
                    pp.leisure,
                    pp.shop,
                    z.minutes AS zone_minutes
                FROM poi_points_within_15 pp
                JOIN LATERAL (
                    SELECT minutes
                    FROM zone_polygons_final z
                    WHERE ST_Covers(z.geom, pp.point_geom)
                       OR ST_DWithin(
                            z.geom,
                            pp.point_geom,
                            0.00008
                        )
                    ORDER BY minutes ASC
                    LIMIT 1
                ) z ON true
            ),
            reachable_pois_geojson AS (
                SELECT json_build_object(
                    'type', 'FeatureCollection',
                    'features',
                    COALESCE(
                        json_agg(
                            json_build_object(
                                'type', 'Feature',
                                'geometry', ST_AsGeoJSON(p.point_geom)::json,
                                'properties', json_build_object(
                                    'name', COALESCE(p.name, 'Unknown'),
                                    'amenity', p.amenity,
                                    'leisure', p.leisure,
                                    'shop', p.shop,
                                    'zone_minutes', p.zone_minutes
                                )
                            ) ORDER BY p.zone_minutes ASC
                        ),
                        '[]'::json
                    )
                ) AS geojson
                FROM pois_with_zone p
            ),
            analysis_metrics AS (
                SELECT
                    COALESCE(
                        (
                            SELECT SUM(ST_Area(z.geom::geography)) / 10000.0
                            FROM zone_polygons_final z
                            WHERE z.minutes = 15
                        ),
                        0.0
                    )::DOUBLE PRECISION AS walkable_area_ha,
                    COALESCE(
                        (
                            SELECT SUM(ST_Length(zes.geom::geography)) / 1000.0
                            FROM zone_edge_segments zes
                            WHERE zes.minutes = 15
                              AND zes.geom IS NOT NULL
                              AND NOT ST_IsEmpty(zes.geom)
                        ),
                        0.0
                    )::DOUBLE PRECISION AS street_reach_km,
                    COALESCE(
                        (
                            SELECT COUNT(DISTINCT ddr.node_id)
                            FROM driving_distance_raw ddr
                            WHERE ddr.node_id IS NOT NULL
                              AND ddr.node_id <> -1
                              AND ddr.agg_cost_m <= (SELECT max_distance_m FROM inputs)
                        ),
                        0
                    )::INT AS connected_nodes
            )
            SELECT
                COALESCE(
                    (SELECT geojson FROM isochrone_15_geojson),
                    '{"type":"FeatureCollection","features":[]}'::json
                )::text AS isochrone_geojson,
                COALESCE(
                    (SELECT geojson FROM isochrones_geojson),
                    '{"type":"FeatureCollection","features":[]}'::json
                )::text AS isochrones_geojson,
                COALESCE(
                    (SELECT geojson FROM reachable_pois_geojson),
                    '{"type":"FeatureCollection","features":[]}'::json
                )::text AS reachable_pois_geojson,
                (SELECT walkable_area_ha FROM analysis_metrics) AS walkable_area_ha,
                (SELECT street_reach_km FROM analysis_metrics) AS street_reach_km,
                (SELECT connected_nodes FROM analysis_metrics) AS connected_nodes,
                (SELECT osmid FROM start_node) AS nearest_node;
            """;
    }
}
