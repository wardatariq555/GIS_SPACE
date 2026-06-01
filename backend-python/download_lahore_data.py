import osmnx as ox
import geopandas as gpd

# -----------------------------------
# Study Area
# -----------------------------------

place_name ="Lahore District, Punjab, Pakistan"

# -----------------------------------
# Download Lahore Boundary
# -----------------------------------

print("Downloading Lahore boundary...")

boundary = ox.geocode_to_gdf(place_name)

boundary.to_file(
    "../Data/lahore_boundary.geojson",
    driver="GeoJSON"
)

print("Boundary downloaded!")

# -----------------------------------
# Download Walking Network
# -----------------------------------

print("Downloading walking network...")

G = ox.graph_from_place(
    place_name,
    network_type="walk"
)

nodes, edges = ox.graph_to_gdfs(G)

nodes.to_file(
    "../Data/walk_nodes.geojson",
    driver="GeoJSON"
)

edges.to_file(
    "../Data/walk_edges.geojson",
    driver="GeoJSON"
)

print("Walking network downloaded!")

# -----------------------------------
# Download POIs
# -----------------------------------

tags = {
    "amenity": [
        "school",
        "hospital",
        "bus_station"
    ],
    "leisure": [
        "park"
    ],
    "shop": [
        "supermarket"
    ]
}

print("Downloading POIs...")

pois = ox.features_from_place(
    place_name,
    tags
)

pois.to_file(
    "../Data/lahore_pois.geojson",
    driver="GeoJSON"
)

print("POIs downloaded!")

print("All Lahore GIS data downloaded successfully!")