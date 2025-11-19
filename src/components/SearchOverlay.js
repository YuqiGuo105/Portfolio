import { useEffect, useMemo, useRef, useState } from "react";

const SOURCE_OPTIONS = [
  { value: "", label: "All" },
  { value: "blog", label: "Blog" },
  { value: "project", label: "Projects" },
  { value: "life", label: "Life" },
];

const formatDate = (value) => {
  if (!value) return null;
  try {
    return new Intl.DateTimeFormat("en", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(value));
  } catch (error) {
    return null;
  }
};

const ResultRow = ({ item, onNavigate }) => {
  return (
    <a
      href={item.url || "#"}
      onClick={onNavigate}
      className="block border-b border-slate-800/60 bg-slate-900/60 p-4 transition hover:bg-slate-800/70"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm uppercase tracking-wide text-slate-400">{item.source}</p>
          <h3 className="text-lg font-semibold text-white">{item.title || "Untitled"}</h3>
        </div>
        {item.tags && (
          <span className="rounded-full bg-slate-800 px-3 py-1 text-xs uppercase tracking-wide text-slate-300">
            {item.tags}
          </span>
        )}
      </div>
      {item.description && (
        <p className="mt-2 text-sm text-slate-300 overflow-hidden text-ellipsis">{item.description}</p>
      )}
      <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
        <span className="font-medium">{item.url}</span>
        {formatDate(item.publishedAt) && <span>{formatDate(item.publishedAt)}</span>}
      </div>
    </a>
  );
};

const SearchOverlay = ({ isOpen, onClose }) => {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [results, setResults] = useState([]);
  const [total, setTotal] = useState(0);
  const [hasTyped, setHasTyped] = useState(false);
  const inputRef = useRef(null);

  const debouncedQuery = useMemo(() => query.trim(), [query]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handler = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      setResults([]);
      setTotal(0);
      setError(null);
      setHasTyped(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!debouncedQuery) {
      setResults([]);
      setTotal(0);
      setError(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: debouncedQuery, limit: "10" });
      if (source) {
        params.set("source", source);
      }

      fetch(`/api/search?${params.toString()}`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            throw new Error(payload.error || "Unable to search right now");
          }
          return response.json();
        })
        .then((payload) => {
          setResults(payload.results || []);
          setTotal(payload.total || 0);
        })
        .catch((err) => {
          if (err.name === "AbortError") return;
          setError(err.message);
          setResults([]);
          setTotal(0);
        })
        .finally(() => setLoading(false));
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [debouncedQuery, source]);

  useEffect(() => {
    setHasTyped(Boolean(query));
  }, [query]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/70 backdrop-blur-sm">
      <div className="mt-14 w-full max-w-4xl rounded-2xl border border-slate-800 bg-slate-900/95 shadow-2xl">
        <div className="flex items-center gap-3 border-b border-slate-800 px-5 py-4">
          <div className="flex flex-1 items-center gap-3 rounded-xl bg-slate-800 px-3">
            <span className="text-slate-300">
              <i className="fa fa-search" aria-hidden="true"></i>
            </span>
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="flex-1 bg-transparent py-3 text-lg text-white placeholder:text-slate-400 focus:outline-none"
              placeholder="Search posts, projects, tags..."
              aria-label="Search"
            />
          </div>
          <select
            value={source}
            onChange={(event) => setSource(event.target.value)}
            className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-medium text-white focus:outline-none"
          >
            {SOURCE_OPTIONS.map((option) => (
              <option key={option.value || "all"} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-700 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-800"
          >
            Esc
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto">
          {loading && (
            <div className="px-5 py-6 text-sm text-slate-300">Searching...</div>
          )}

          {!loading && error && (
            <div className="px-5 py-6 text-sm text-red-400">{error}</div>
          )}

          {!loading && !error && results.length === 0 && hasTyped && (
            <div className="px-5 py-6 text-sm text-slate-300">No results yet. Try different keywords.</div>
          )}

          {!loading && !error && !hasTyped && (
            <div className="px-5 py-6 text-sm text-slate-300">
              Start typing to search across articles, projects and more.
            </div>
          )}

          {!loading && !error && results.length > 0 && (
            <>
              <div className="flex items-center justify-between px-5 py-3 text-xs uppercase tracking-wide text-slate-400">
                <span>Results</span>
                <span>{total} found</span>
              </div>
              <div className="divide-y divide-slate-800">
                {results.map((item) => (
                  <ResultRow key={`${item.source}-${item.id}`} item={item} onNavigate={onClose} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default SearchOverlay;
