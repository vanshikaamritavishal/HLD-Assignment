import "@/App.css";
import { BrowserRouter, Routes, Route, Link, useLocation } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import SearchPage from "@/pages/SearchPage";
import ArchitecturePage from "@/pages/ArchitecturePage";

function NavBar() {
  const { pathname } = useLocation();
  const link = (to, label, testId) => (
    <Link
      to={to}
      data-testid={testId}
      className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
        pathname === to
          ? "bg-zinc-900 text-white"
          : "text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100"
      }`}
    >
      {label}
    </Link>
  );
  return (
    <nav className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 bg-white/80 backdrop-blur-md sticky top-0 z-50">
      <Link to="/" data-testid="nav-brand" className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-md bg-gradient-to-br from-zinc-900 to-zinc-700 flex items-center justify-center">
          <span className="text-white text-xs font-bold">T</span>
        </div>
        <span className="font-semibold text-zinc-900 tracking-tight">Typeahead<span className="text-zinc-400 font-normal">·HLD</span></span>
      </Link>
      <div className="flex items-center gap-1">
        {link("/", "Search", "nav-search")}
        {link("/architecture", "Architecture", "nav-architecture")}
      </div>
    </nav>
  );
}

function App() {
  return (
    <div className="App min-h-screen bg-zinc-50 text-zinc-900">
      <BrowserRouter>
        <NavBar />
        <Routes>
          <Route path="/" element={<SearchPage />} />
          <Route path="/architecture" element={<ArchitecturePage />} />
        </Routes>
        <Toaster position="bottom-right" />
      </BrowserRouter>
    </div>
  );
}

export default App;
