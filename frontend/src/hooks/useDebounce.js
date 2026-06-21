import { useEffect, useState } from "react";

/**
 * Debounce a value. Used by the search box so we don't fire a /suggest
 * request on every single keystroke — instead we wait for the user to pause
 * typing, which both improves UX and reduces backend load.
 */
export default function useDebounce(value, delay = 150) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
