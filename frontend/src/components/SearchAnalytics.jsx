import { useEffect, useState } from "react";
import { getMetrics } from "@/lib/api";

/**
 * SearchAnalytics
 *
 * Minimal counters required by the assignment's "Search analytics tracking"
 * bullet. Intentionally kept tiny — three numbers, no live charts, no
 * monitoring dashboard. They refresh once every 4s so the user can see the
 * impact of their searches without making the UI feel like an ops console.
 */
export default function SearchAnalytics({ refreshKey }) {
  const [m, setM] = useState(null);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try { const x = await getMetrics(); if (!stop) setM(x); } catch {}
    };
    tick();
    const iv = setInterval(tick, 4000);
    return () => { stop = true; clearInterval(iv); };
  }, [refreshKey]);

  if (!m) return null;

  const cache = m.cache;
  const batch = m.batch;
  const total = cache.totalHits + cache.totalMisses;
  const hitPct = total === 0 ? 0 : Math.round(cache.hitRate * 100);

  return (
    <div
      data-testid="search-analytics"
      className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 mt-6 text-xs text-zinc-500"
    >
      <span data-testid="analytics-total-searches">
        Searches submitted: <span className="font-medium text-zinc-800">{batch.submissions}</span>
      </span>
      <span data-testid="analytics-cache-hits">
        Cache hits / misses: <span className="font-medium text-zinc-800">{cache.totalHits} / {cache.totalMisses}</span>
        {total > 0 && <span className="ml-1 text-zinc-400">({hitPct}%)</span>}
      </span>
      <span data-testid="analytics-writes-saved">
        DB writes saved by batching: <span className="font-medium text-zinc-800">{batch.writesSaved}</span>
      </span>
    </div>
  );
}
