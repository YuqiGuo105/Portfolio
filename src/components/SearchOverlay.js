import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
      className="block border-b border-slate-800/60 bg-slate-900/60 p-4 transition hover:bg-slate-800/70 search-result-row"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3 search-result-row__top">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-slate-400 search-result-row__source sm:text-sm">
            {item.source}
          </p>
          <h3 className="text-base font-semibold text-white search-result-row__title sm:text-lg">
            {item.title || "Untitled"}
          </h3>
        </div>
        {item.tags && (
          <span className="rounded-full bg-slate-800 px-3 py-1 text-xs uppercase tracking-wide text-slate-300 search-result-row__tag">
            {item.tags}
          </span>
        )}
      </div>
      <div className="mt-3 flex flex-col items-start gap-2 text-xs text-slate-400 search-result-row__meta sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <span
          className="font-medium truncate max-w-full search-result-row__url sm:max-w-[70%]"
          title={item.url || undefined}
        >
          {item.url}
        </span>
        {formatDate(item.publishedAt) && (
          <span>{formatDate(item.publishedAt)}</span>
        )}
      </div>
    </a>
  );
};

const SearchOverlay = ({ isOpen, onClose }) => {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [source, setSource] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [results, setResults] = useState([]);
  const [total, setTotal] = useState(0);
  const [hasTyped, setHasTyped] = useState(false);
  const inputRef = useRef(null);

  const trimmedQuery = useMemo(() => query.trim(), [query]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleInputChange = useCallback((event) => {
    setQuery(event.target.value);
  }, []);

  const handleSourceChange = useCallback((event) => {
    setSource(event.target.value);
  }, []);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handler = (event) => {
      if (event.key === "Escape") {
        handleClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleClose, isOpen]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus({ preventScroll: true });
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
    const timer = setTimeout(() => setDebouncedQuery(trimmedQuery), 250);
    return () => clearTimeout(timer);
  }, [trimmedQuery]);

  useEffect(() => {
    if (!isOpen) return undefined;

    if (!debouncedQuery) {
      setResults([]);
      setTotal(0);
      setError(null);
      return undefined;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

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

    return () => {
      controller.abort();
    };
  }, [debouncedQuery, isOpen, source]);

  useEffect(() => {
    setHasTyped(Boolean(query));
  }, [query]);

  if (!isOpen) return null;

  const handleBackdropClick = (event) => {
    if (event.target === event.currentTarget) {
      handleClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/70 px-4 py-4 backdrop-blur-sm search-overlay sm:px-0 sm:py-0"
      onClick={handleBackdropClick}
    >
      <div
        className="mt-2 flex w-full max-w-4xl flex-col rounded-2xl border border-slate-800 bg-slate-900/95 shadow-2xl search-overlay__panel sm:mt-14"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 px-4 py-3 search-overlay__header sm:flex-nowrap sm:gap-3 sm:px-5 sm:py-4">
          <div className="flex min-w-0 flex-1 items-center gap-3 rounded-xl bg-slate-800 px-3 search-overlay__input-wrap">
            <span className="text-slate-300 search-overlay__icon">
              <i className="fa fa-search" aria-hidden="true"></i>
            </span>
            <input
              ref={inputRef}
              value={query}
              onChange={handleInputChange}
              className="flex-1 h-10 bg-transparent py-2 text-base text-white placeholder:text-slate-400 focus:outline-none search-overlay__input sm:py-3 sm:text-lg"
              placeholder="Search posts, projects, tags..."
              aria-label="Search"
            />
          </div>
          <select
            value={source}
            onChange={handleSourceChange}
            className="search-select search-overlay__select w-full text-sm sm:w-auto sm:text-base"
          >
            {SOURCE_OPTIONS.map((option) => (
              <option key={option.value || "all"} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleClose}
            className="search-close search-overlay__close ml-auto h-10 w-10 sm:ml-0"
            aria-label="Close search"
          >
            ×
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto search-overlay__body sm:max-h-[70vh]">
          {loading && (
            <div className="px-5 py-6 text-sm text-slate-300 search-overlay__section">
              Searching...
            </div>
          )}

          {!loading && error && (
            <div className="px-5 py-6 text-sm text-red-400 search-overlay__section search-overlay__section--error">
              {error}
            </div>
          )}

          {!loading && !error && results.length === 0 && hasTyped && (
            <div className="px-5 py-6 text-sm text-slate-300 search-overlay__section">
              No results yet. Try different keywords.
            </div>
          )}

          {!loading && !error && !hasTyped && (
            <div className="px-5 py-6 text-sm text-slate-300 search-overlay__section">
              Start typing to search across articles, projects and more.
            </div>
          )}

          {!loading && !error && results.length > 0 && (
            <>
              <div className="flex items-center justify-between px-5 py-3 text-xs uppercase tracking-wide text-slate-400 search-overlay__results-header">
                <span>Results</span>
                <span>{total} found</span>
              </div>
              <div className="divide-y divide-slate-800 search-overlay__results-list">
                {results.map((item) => (
                  <ResultRow
                    key={`${item.source}-${item.id}`}
                    item={item}
                    onNavigate={handleClose}
                  />
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
