import { useState } from "react";
import SearchBox from "@/components/SearchBox";
import TrendingSearches from "@/components/TrendingSearches";
import CacheDebugPanel from "@/components/CacheDebugPanel";
import HashRingVisualizer from "@/components/HashRingVisualizer";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sparkles, BarChart3 } from "lucide-react";

export default function SearchPage() {
  const [mode, setMode] = useState("basic"); // 'basic' | 'trending'
  const [refresh, setRefresh] = useState(0);

  return (
    <main className="max-w-6xl mx-auto px-6 py-10">
      {/* Hero */}
      <div className="text-center mb-8 fade-up">
        <div className="inline-flex items-center gap-2 px-3 py-1 mb-4 bg-zinc-100 border border-zinc-200 rounded-full text-xs text-zinc-600">
          <BarChart3 className="w-3 h-3" />
          HLD Demo · ~150K queries · 3-node distributed cache
        </div>
        <h1 className="font-display text-5xl sm:text-6xl text-zinc-900 leading-tight">
          A search box, <span className="italic text-zinc-500">but with a backbone.</span>
        </h1>
        <p className="mt-3 text-zinc-600 max-w-xl mx-auto">
          Type to see top-10 suggestions sorted by popularity, served from a
          consistent-hashed cache. Switch to <b>Trending</b> mode to blend in
          recency-weighted scoring.
        </p>
      </div>

      {/* Mode toggle */}
      <div className="flex justify-center mb-3">
        <Tabs value={mode} onValueChange={setMode}>
          <TabsList data-testid="mode-tabs">
            <TabsTrigger value="basic" data-testid="mode-basic">
              <Sparkles className="w-3.5 h-3.5 mr-1.5" /> Basic (by count)
            </TabsTrigger>
            <TabsTrigger value="trending" data-testid="mode-trending">
              <Sparkles className="w-3.5 h-3.5 mr-1.5" /> Trending (count + recency)
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Search box */}
      <div className="max-w-2xl mx-auto">
        <SearchBox mode={mode} onSubmitted={() => setRefresh((x) => x + 1)} />
      </div>

      {/* Below: live system panel + trending + ring */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-10">
        <div className="lg:col-span-2 space-y-4">
          <CacheDebugPanel refreshKey={refresh} />
        </div>
        <div className="space-y-4">
          <TrendingSearches refreshKey={refresh} onPick={() => {}} />
          <HashRingVisualizer />
        </div>
      </div>

      <footer className="text-center text-xs text-zinc-400 mt-12">
        Type a few queries, then watch the cache hit-rate climb and the batch
        writer save DB ops on the panel above. Every metric is computed live by
        the Node.js backend.
      </footer>
    </main>
  );
}
