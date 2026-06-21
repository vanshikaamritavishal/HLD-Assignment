import { useEffect, useRef, useState } from "react";
import { Search, CornerDownLeft, Zap, Database } from "lucide-react";
import { getSuggestions, submitSearch } from "@/lib/api";
import useDebounce from "@/hooks/useDebounce";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

/**
 * Typeahead search box.
 * - Debounced backend calls (150ms) — avoids one request per keystroke.
 * - Arrow-key navigation through the dropdown.
 * - Enter (or click) submits the search; backend buffers it for batch write.
 * - Shows a tiny "cache hit/miss + node + latency" indicator on every result.
 */
export default function SearchBox({ mode, onSubmitted }) {
  const [q, setQ] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [cacheInfo, setCacheInfo] = useState(null);
  const [latency, setLatency] = useState(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const debounced = useDebounce(q, 150);
  const inputRef = useRef(null);

  // Fetch suggestions whenever the debounced query OR mode changes.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!debounced.trim()) {
        setSuggestions([]); setCacheInfo(null); setLatency(null); return;
      }
      setLoading(true); setError(null);
      try {
        const data = await getSuggestions(debounced.trim(), mode);
        if (cancelled) return;
        setSuggestions(data.suggestions || []);
        setCacheInfo(data.cache || null);
        setLatency(typeof data.latencyMs === "number" ? data.latencyMs : null);
        setActive(-1);
      } catch (e) {
        if (!cancelled) setError("Failed to fetch suggestions");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [debounced, mode]);

  const handleKey = (e) => {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(suggestions.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(-1, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const chosen = active >= 0 ? suggestions[active].query : q;
      doSubmit(chosen);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const doSubmit = async (text) => {
    const value = (text || q).trim();
    if (!value) return;
    setQ(value);
    setOpen(false);
    try {
      const res = await submitSearch(value);
      toast.success(`Searched: "${value}"`, { description: res.message });
      onSubmitted?.(value);
    } catch {
      toast.error("Search submit failed");
    }
  };

  return (
    <div className="relative w-full">
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-400" />
        <input
          ref={inputRef}
          data-testid="search-input"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={handleKey}
          placeholder="Search anything… try “iphone”, “best laptop”, “java tutorial”"
          className="w-full pl-12 pr-32 py-4 text-lg bg-white border border-zinc-200 rounded-2xl shadow-sm focus:outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 transition-all"
        />
        <button
          data-testid="search-submit"
          onClick={() => doSubmit()}
          className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5 px-3 py-1.5 text-sm bg-zinc-900 text-white rounded-lg hover:bg-zinc-800 transition-colors"
        >
          Search <CornerDownLeft className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Cache/latency strip */}
      {(cacheInfo || latency !== null) && q && (
        <div className="flex items-center gap-3 mt-2 px-2 text-xs text-zinc-500" data-testid="search-cache-strip">
          {cacheInfo && (
            <Badge variant="outline" className={`gap-1 ${cacheInfo.hit ? "border-emerald-300 text-emerald-700 bg-emerald-50" : "border-amber-300 text-amber-700 bg-amber-50"}`}>
              <Database className="w-3 h-3" />
              {cacheInfo.hit ? "Cache HIT" : "Cache MISS"}
              {cacheInfo.nodeId && <span className="mono">· {cacheInfo.nodeId}</span>}
            </Badge>
          )}
          {latency !== null && (
            <span className="flex items-center gap-1 mono">
              <Zap className="w-3 h-3" /> {latency} ms
            </span>
          )}
          {loading && <span className="text-zinc-400">searching…</span>}
          {error && <span className="text-red-500">{error}</span>}
        </div>
      )}

      {/* Suggestion dropdown */}
      {open && suggestions.length > 0 && (
        <div
          data-testid="suggestion-dropdown"
          className="absolute left-0 right-0 mt-2 bg-white border border-zinc-200 rounded-xl shadow-lg overflow-hidden fade-up z-40"
        >
          {suggestions.map((s, i) => (
            <button
              key={s.query}
              data-testid={`suggestion-item-${i}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => doSubmit(s.query)}
              className={`w-full flex items-center justify-between px-4 py-2.5 text-left text-sm transition-colors ${
                i === active ? "bg-zinc-100" : "hover:bg-zinc-50"
              }`}
            >
              <span>
                <HighlightedQuery text={s.query} prefix={q} />
              </span>
              <span className="mono text-xs text-zinc-400">
                {typeof s.score === "number" ? `score ${s.score}` : `count ${s.count?.toLocaleString?.() ?? s.count}`}
              </span>
            </button>
          ))}
        </div>
      )}
      {open && q && !loading && suggestions.length === 0 && (
        <div className="absolute left-0 right-0 mt-2 bg-white border border-zinc-200 rounded-xl shadow-lg p-4 text-sm text-zinc-500 fade-up">
          No suggestions. Press <kbd className="mono px-1 py-0.5 bg-zinc-100 rounded text-xs">Enter</kbd> to record this as a new search.
        </div>
      )}
    </div>
  );
}

function HighlightedQuery({ text, prefix }) {
  const p = String(prefix || "").toLowerCase();
  const t = String(text || "");
  if (!p || !t.toLowerCase().startsWith(p)) return <span>{t}</span>;
  return (
    <>
      <span className="font-semibold text-zinc-900">{t.slice(0, p.length)}</span>
      <span className="text-zinc-600">{t.slice(p.length)}</span>
    </>
  );
}
