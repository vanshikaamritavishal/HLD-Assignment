import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import SearchPage from "@/pages/SearchPage";

/**
 * App shell.
 *
 * Per the assignment's Expected Submission section, architecture / design
 * notes live in markdown files (README.md, ARCHITECTURE.md,
 * PROJECT_REPORT.md), NOT in extra app pages. So the React app exposes only
 * the single page the user interacts with: the search experience.
 */
function App() {
  return (
    <div className="App min-h-screen bg-zinc-50 text-zinc-900">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<SearchPage />} />
        </Routes>
        <Toaster position="bottom-right" />
      </BrowserRouter>
    </div>
  );
}

export default App;
