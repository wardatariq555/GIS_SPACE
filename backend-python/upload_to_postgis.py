import geopandas as gpd
from sqlalchemy import create_engine

# -----------------------------------------
# PostgreSQL Connection
# -----------------------------------------

DATABASE_URL = (
    "postgresql://postgres:postgres@localhost:5432/lahore_15min_city"          # Question? how do we now the port  number ?
)

engine = create_engine(DATABASE_URL)

# -----------------------------------------
# Load GeoJSON Files
# -----------------------------------------

boundary = gpd.read_file("../Data/lahore_boundary.geojson")

walk_nodes = gpd.read_file("../Data/walk_nodes.geojson")

walk_edges = gpd.read_file("../Data/walk_edges.geojson")

pois = gpd.read_file("../Data/lahore_pois.geojson")

# -----------------------------------------
# Upload To PostGIS
# -----------------------------------------

print("Uploading boundary...")

boundary.to_postgis(
    "lahore_boundary",
    engine,
    if_exists="replace"
)

print("Uploading walk nodes...")

walk_nodes.to_postgis(
    "walk_nodes",
    engine,
    if_exists="replace"
)

print("Uploading walk edges...")

walk_edges.to_postgis(
    "walk_edges",
    engine,
    if_exists="replace"
)

print("Uploading POIs...")

pois.to_postgis(
    "lahore_pois",
    engine,
    if_exists="replace"
)

print("All layers uploaded successfully!")