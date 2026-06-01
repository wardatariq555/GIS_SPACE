export const POI_CATEGORY_CONFIG = [
  {
    key: "healthcare",
    label: "Health Care",
    color: "#f472b6",
    symbol: "H"
  },
  {
    key: "schools",
    label: "Schools",
    color: "#3b82f6",
    symbol: "S"
  },
  {
    key: "parks",
    label: "Parks",
    color: "#22c55e",
    symbol: "P"
  },
  {
    key: "transit",
    label: "Transit",
    color: "#8b5cf6",
    symbol: "T"
  },
  {
    key: "markets",
    label: "Markets",
    color: "#f59e0b",
    symbol: "M"
  }
];

export const OTHER_POI_CATEGORY = {
  key: "other",
  label: "Other",
  color: "#64748b",
  symbol: "?"
};

const CATEGORY_LOOKUP = new Map(
  [...POI_CATEGORY_CONFIG, OTHER_POI_CATEGORY].map((item) => [item.key, item])
);

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

function normalizeTag(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function matchesCategory(properties, categoryKey) {
  const amenity = normalizeTag(properties?.amenity);
  const leisure = normalizeTag(properties?.leisure);
  const shop = normalizeTag(properties?.shop);

  if (categoryKey === "healthcare") return HEALTHCARE_AMENITIES.has(amenity);
  if (categoryKey === "schools") return SCHOOL_AMENITIES.has(amenity);
  if (categoryKey === "parks") return PARK_TYPES.has(leisure);
  if (categoryKey === "transit") return TRANSIT_AMENITIES.has(amenity);
  if (categoryKey === "markets") return MARKET_SHOPS.has(shop);

  return false;
}

export function resolveFeatureCategory(properties) {
  for (const category of POI_CATEGORY_CONFIG) {
    if (matchesCategory(properties, category.key)) {
      return category.key;
    }
  }

  return OTHER_POI_CATEGORY.key;
}

export function getCategoryConfig(categoryKey) {
  return CATEGORY_LOOKUP.get(categoryKey) ?? OTHER_POI_CATEGORY;
}
