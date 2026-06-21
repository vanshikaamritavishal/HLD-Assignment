import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

const client = axios.create({ baseURL: API, timeout: 10_000 });

export async function getSuggestions(q, mode = "basic") {
  if (!q) return { suggestions: [], cache: { hit: false, nodeId: null }, mode };
  const { data } = await client.get("/suggest", { params: { q, mode } });
  return data;
}

export async function submitSearch(q) {
  const { data } = await client.post("/search", { q });
  return data;
}

export async function getTrending(limit = 10) {
  const { data } = await client.get("/trending", { params: { limit } });
  return data.trending || [];
}

export async function getCacheDebug(q, mode = "basic") {
  const { data } = await client.get("/cache/debug", { params: { q, mode } });
  return data;
}

export async function getMetrics() {
  const { data } = await client.get("/metrics");
  return data;
}

export async function getRing() {
  const { data } = await client.get("/ring");
  return data;
}

export async function forceFlush() {
  const { data } = await client.post("/admin/flush");
  return data;
}

export async function resetMetrics() {
  const { data } = await client.post("/admin/reset-metrics");
  return data;
}

export async function clearCache() {
  const { data } = await client.post("/admin/clear-cache");
  return data;
}
