# ==================================================
# IMPORT LIBRARIES
# ==================================================

import osmnx as ox
import networkx as nx
import geopandas as gpd
import shapely.geometry as geom
import sys

# ==================================================
# USER CLICK COORDINATES
# ==================================================

# Longitude from frontend
lng = float(sys.argv[1])

# Latitude from frontend
lat = float(sys.argv[2])

# ==================================================
# CREATE CLICK POINT
# ==================================================

# Create shapely point geometry
click_point = geom.Point(lng, lat)

# Convert point into GeoDataFrame
point_gdf = gpd.GeoDataFrame(
    geometry=[click_point],
    crs="EPSG:4326"
)

# ==================================================
# CREATE 3 KM BUFFER
# ==================================================

# Convert to metric projection
point_projected = point_gdf.to_crs(3857)

# Create 3000 meter buffer
buffer = point_projected.buffer(3000)

# Convert back to WGS84
buffer_wgs84 = gpd.GeoSeries(
    buffer,
    crs=3857
).to_crs(4326)

# ==================================================
# DOWNLOAD ONLY LOCAL ROADS
# ==================================================

# Extract polygon geometry
polygon = buffer_wgs84.iloc[0]

# Download ONLY roads inside buffer
G = ox.graph_from_polygon(
    polygon,
    network_type="walk"
)

# ==================================================
# FIND NEAREST NODE
# ==================================================

# Find closest road node to click point
center_node = ox.distance.nearest_nodes(
    G,
    lng,
    lat
)

# ==================================================
# WALKING CONFIGURATION
# ==================================================

# Approx walking speed
speed_m_per_min = 80

# 15 minute threshold
travel_minutes = 15

# Max reachable walking distance
max_distance = (
    speed_m_per_min *
    travel_minutes
)

# ==================================================
# RUN DIJKSTRA ANALYSIS
# ==================================================

# Traverse graph outward
lengths = nx.single_source_dijkstra_path_length(

    G,

    center_node,

    cutoff=max_distance,

    weight="length"
)

# ==================================================
# EXTRACT REACHABLE NODES
# ==================================================

reachable_nodes = list(lengths.keys())

# Convert graph into GeoDataFrames
nodes, edges = ox.graph_to_gdfs(G)

# Keep only reachable nodes
reachable_points = nodes.loc[
    reachable_nodes
]

# ==================================================
# CREATE ISOCHRONE POLYGON
# ==================================================

# Convert to metric CRS
reachable_projected = (
    reachable_points
    .to_crs(3857)
)

# Buffer nodes
buffered = reachable_projected.buffer(250)

# Merge all circles into one polygon
merged = buffered.unary_union

# Convert into GeoDataFrame
isochrone = gpd.GeoDataFrame(
    geometry=[merged],
    crs="EPSG:3857"
).to_crs(4326)

# ==================================================
# RETURN GEOJSON
# ==================================================

print(
    isochrone.to_json()
)