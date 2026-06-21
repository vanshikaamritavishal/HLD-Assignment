/**
 * REST routes for the Search Typeahead service.
 *
 * Endpoints (assignment-spec):
 *   GET  /api/health
 *   GET  /api/suggest?q=<prefix>&mode=basic|trending
 *   POST /api/search                { q: string }
 *   GET  /api/trending?limit=10
 *   GET  /api/cache/debug?q=<prefix>
 *   GET  /api/metrics
 *   POST /api/admin/flush            (force-flush the batch buffer — useful for demos)
 *   POST /api/admin/reset-metrics    (zero out counters for a clean demo)
 *   GET  /api/ring                   (consistent-hash ring snapshot for UI viz)
 */

const express = require("express");

function buildRoutes({ trie, cacheCluster, ring, trending, batch, metrics, db }) {
  const r = express.Router();

  r.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

  // -------- Typeahead Suggestions --------
  r.get("/suggest", (req, res) => {
    const t0 = process.hrtime.bigint();
    const q = String(req.query.q ?? "").trim().toLowerCase();
    const mode = req.query.mode === "trending" ? "trending" : "basic";

    // Empty prefix: return nothing (per spec: graceful handling).
    if (!q) return res.json({ suggestions: [], cache: { hit: false, nodeId: null }, mode });

    // Cache key includes the mode so basic vs trending don't collide.
    const cacheKey = `${mode}:${q}`;
    const { nodeId, hit, value } = cacheCluster.get(cacheKey);
    if (hit) {
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      metrics.recordSuggestLatency(ms);
      return res.json({ suggestions: value, cache: { hit: true, nodeId }, mode, latencyMs: +ms.toFixed(2) });
    }

    // Cache miss — compute from Trie.
    let suggestions = trie.suggest(q, 10);
    if (mode === "trending" && suggestions.length > 0) {
      suggestions = trending.rerank(suggestions).slice(0, 10);
    }
    cacheCluster.set(cacheKey, suggestions);

    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    metrics.recordSuggestLatency(ms);
    res.json({ suggestions, cache: { hit: false, nodeId }, mode, latencyMs: +ms.toFixed(2) });
  });

  // -------- Search Submission --------
  r.post("/search", (req, res) => {
    const q = String(req.body?.q ?? "").trim().toLowerCase();
    if (!q) return res.status(400).json({ error: "q is required" });
    // 1) Buffer for the batch writer (no immediate DB write).
    batch.submit(q, 1);
    // 2) Update trending counter immediately so UI reflects the spike fast.
    trending.record(q);
    // 3) NOTE: we do NOT update the trie yet; that happens on batch flush so
    //    that the suggestions reflect the durable state.
    res.json({ message: "Searched", query: q });
  });

  // -------- Trending --------
  r.get("/trending", (req, res) => {
    const limit = Math.min(50, parseInt(req.query.limit || "10", 10));
    const trendList = trending.topTrending(limit).map((t) => {
      // include historical count for context (from trie top1 for the exact query)
      const exact = trie.suggest(t.query, 1)[0];
      return { ...t, historicalCount: exact && exact.query === t.query ? exact.count : null };
    });
    res.json({ trending: trendList });
  });

  // -------- Cache Debug --------
  r.get("/cache/debug", (req, res) => {
    const q = String(req.query.q ?? "").trim().toLowerCase();
    const mode = req.query.mode === "trending" ? "trending" : "basic";
    if (!q) return res.status(400).json({ error: "q is required" });
    const cacheKey = `${mode}:${q}`;
    const nodeId = ring.getNode(cacheKey);
    const node = cacheCluster.nodes.get(nodeId);
    const entry = node.map.get(cacheKey);
    res.json({
      prefix: q,
      mode,
      cacheKey,
      ownerNode: nodeId,
      hit: !!entry && entry.expiresAt > Date.now(),
      expiresInMs: entry ? Math.max(0, entry.expiresAt - Date.now()) : null,
      ringSize: ring.ring.length,
    });
  });

  // -------- Metrics & Stats --------
  r.get("/metrics", (_req, res) => {
    res.json({
      cache: cacheCluster.stats(),
      latency: metrics.snapshot(),
      batch: batch.snapshot(),
      trie: { keys: trie.size },
    });
  });

  // -------- Ring snapshot for visualization --------
  r.get("/ring", (_req, res) => {
    res.json({
      nodes: [...cacheCluster.nodes.keys()],
      virtualNodes: ring.virtualNodes,
      sample: ring.snapshot(48),
    });
  });

  // -------- Admin / Demo helpers --------
  r.post("/admin/flush", async (_req, res) => {
    await batch.flush();
    res.json({ ok: true, ...batch.snapshot() });
  });

  r.post("/admin/reset-metrics", (_req, res) => {
    metrics.reset();
    for (const n of cacheCluster.nodes.values()) { n.hits = 0; n.misses = 0; n.evictions = 0; }
    res.json({ ok: true });
  });

  r.post("/admin/clear-cache", (_req, res) => {
    cacheCluster.clear();
    res.json({ ok: true });
  });

  return r;
}

module.exports = buildRoutes;
