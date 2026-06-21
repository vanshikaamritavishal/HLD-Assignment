import { useState } from "react";
import SearchBox from "@/components/SearchBox";
import TrendingSearches from "@/components/TrendingSearches";
import SearchAnalytics from "@/components/SearchAnalytics";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * Search page.
 *
 * Layout intentionally kept minimal — just the controls the assignment
 * requires:
 *   • A search input box.
 *   • A suggestion dropdown (rendered by <SearchBox/>).
 *   • A toggle between Basic ranking (count) and Trending ranking (count +
 *     recency) so the difference is easy to demo during the viva.
 *   • A Trending Searches section.
 *   • A small analytics strip (3 numbers) covering the "Search analytics
 *     tracking" requirement.
 *
 * Architecture / design content lives in README.md, ARCHITECTURE.md, and
 * PROJECT_REPORT.md — NOT in the UI.
 */
export default function SearchPage() {
  const [mode, setMode] = useState("basic"); // 'basic' | 'trending'
  const [refresh, setRefresh] = useState(0); // bumps when a search is submitted

  return (
    <main className="max-w-3xl mx-auto px-6 py-12">
      <header className="text-center mb-8">
        <h1 className="font-display text-4xl sm:text-5xl text-zinc-900 leading-tight">
          Search Typeahead
        </h1>
        <p className="mt-2 text-sm text-zinc-600">
          Start typing to see the top 10 suggestions ranked by popularity.
          Switch to <b>Trending</b> to blend in recency.
        </p>
      </header>

      {/* Mode toggle — Basic vs Trending ranking */}
      <div className="flex justify-center mb-3">
        <Tabs value={mode} onValueChange={setMode}>
          <TabsList data-testid="mode-tabs">
            <TabsTrigger value="basic" data-testid="mode-basic">
              Basic (by count)
            </TabsTrigger>
            <TabsTrigger value="trending" data-testid="mode-trending">
              Trending (count + recency)
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Search input + suggestions dropdown */}
      <SearchBox mode={mode} onSubmitted={() => setRefresh((x) => x + 1)} />

      {/* Trending searches list — auto-refreshes every 3s. */}
      <div className="mt-8">
        <TrendingSearches refreshKey={refresh} onPick={() => {}} />
      </div>

      {/* Minimal analytics line — satisfies the "Search analytics" requirement
          without turning the UI into a monitoring dashboard. */}
      <SearchAnalytics refreshKey={refresh} />
    </main>
  );
}
