import { useEffect, useState } from "react";
import { TrendingUp, Flame } from "lucide-react";
import { getTrending } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function TrendingSearches({ refreshKey, onPick }) {
  const [items, setItems] = useState([]);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let stop = false;
    const fetchOnce = async () => {
      try { const r = await getTrending(10); if (!stop) setItems(r); }
      catch { if (!stop) setErr("Failed to load trending"); }
    };
    fetchOnce();
    const iv = setInterval(fetchOnce, 3000); // auto-refresh every 3s
    return () => { stop = true; clearInterval(iv); };
  }, [refreshKey]);

  return (
    <Card data-testid="trending-card" className="border-zinc-200">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Flame className="w-4 h-4 text-orange-500" />
          Trending Now
          <span className="ml-auto text-xs font-normal text-zinc-400">
            count + recency
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 pt-0">
        {items.length === 0 && (
          <div className="text-sm text-zinc-400 py-4 text-center">
            No trending yet. Submit a few searches above.
          </div>
        )}
        {items.map((t, i) => (
          <button
            key={t.query}
            data-testid={`trending-item-${i}`}
            onClick={() => onPick?.(t.query)}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-zinc-50 transition-colors text-left"
          >
            <span className="flex items-center gap-2 text-sm">
              <span className="w-5 text-zinc-400 mono text-xs">{i + 1}.</span>
              <span className="text-zinc-800">{t.query}</span>
            </span>
            <span className="flex items-center gap-2 text-xs text-zinc-500">
              <TrendingUp className="w-3 h-3 text-emerald-500" />
              <span className="mono">{t.recency}</span>
            </span>
          </button>
        ))}
        {err && <div className="text-xs text-red-500">{err}</div>}
      </CardContent>
    </Card>
  );
}
