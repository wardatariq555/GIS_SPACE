const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:5109";

async function requestJson(path) {
  const response = await fetch(`${API_BASE_URL}${path}`);

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}): ${path}`);
  }

  return response.json();
}

export async function getBoundary() {
  const payload = await requestJson("/api/boundary");

  // Backend boundary endpoint currently returns a JSON string payload.
  if (typeof payload === "string") {
    return JSON.parse(payload);
  }

  return payload;
}

export function buildAnalysisUrl(lng, lat) {
  const query = new URLSearchParams({
    lng: String(lng),
    lat: String(lat)
  });

  return `${API_BASE_URL}/api/analysis?${query.toString()}`;
}
