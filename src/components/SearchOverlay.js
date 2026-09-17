import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, ArrowUpRight, BookOpen, BriefcaseBusiness, Compass, FileText, FolderGit2, LockKeyhole, RotateCw, Search, SearchX, TriangleAlert, X } from "lucide-react";
import { trackBehavior } from "../lib/behaviorAnalytics";
import styles from "../../styles/SearchOverlay.module.css";

const SOURCE_OPTIONS = [
  { value: "", label: "All", icon: Search },
  { value: "blog", label: "Articles", resultLabel: "Blog", icon: FileText },
  { value: "project", label: "Projects", resultLabel: "Projects", icon: FolderGit2 },
  { value: "life", label: "Life", resultLabel: "Life", icon: Compass },
  { value: "resume", label: "Experience", resultLabel: "Resume", icon: BriefcaseBusiness },
];
const COLLECTIONS = [
  { title: "Projects", detail: "Systems, products & open source", url: "/works-list", icon: FolderGit2 },
  { title: "Articles", detail: "Engineering notes & ideas", url: "/blogs", icon: BookOpen },
  { title: "Experience", detail: "Career, education & skills", url: "/cv", icon: BriefcaseBusiness },
];

function ResultRow({ item, onNavigate }) {
  const source = SOURCE_OPTIONS.find(option => option.resultLabel === item.source);
  const Icon = source?.icon || FileText;
  return (
    <a href={item.url} onClick={onNavigate} className={styles.result} data-testid="search-result">
      <span className={styles.sourceIcon} data-source={source?.value}><Icon size={20} aria-hidden="true" /></span>
      <div className={styles.resultContent}>
        <div className={styles.meta}>
          <span>{source?.label || item.source}</span>
          {item.sourceRequiresLogin && <span className={styles.lock}><LockKeyhole size={12} aria-hidden="true" />Sign in to read</span>}
        </div>
        <h3>{item.title || "Untitled"}</h3>
        {item.description && <p className={styles.summary}>{item.description}</p>}
        <div className={styles.resultFooter}>
          <span className={styles.path}>yuqi.site</span>
          {item.tags && <span className={styles.tags}>{item.tags}</span>}
        </div>
      </div>
      <ArrowUpRight className={styles.resultArrow} size={18} aria-hidden="true" />
    </a>
  );
}

export default function SearchOverlay({ isOpen, onClose }) {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("");
  const [composing, setComposing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [results, setResults] = useState([]);
  const [total, setTotal] = useState(0);
  const [retry, setRetry] = useState(0);
  const inputRef = useRef(null);
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  const searchMeta = useRef({});
  closeRef.current = onClose;
  const searchQuery = query.trim();
  const selectedSource = SOURCE_OPTIONS.find(option => option.value === source);

  useEffect(() => {
    if (!isOpen) {
      setQuery(""); setSource(""); setResults([]); setTotal(0); setError(false); setComposing(false);
      return undefined;
    }
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    inputRef.current?.focus({ preventScroll: true });
    const handler = event => {
      if (event.key === "Escape" && !event.isComposing) closeRef.current();
      if (event.key !== "Tab") return;
      const elements = dialogRef.current?.querySelectorAll('input, button:not([disabled]):not([tabindex="-1"]), a[href]');
      const first = elements?.[0], last = elements?.[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus?.({ preventScroll: true });
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !searchQuery || composing) {
      setResults([]); setTotal(0); setError(false); setLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    let disposed = false;
    let deadline;
    setLoading(true); setError(false);
    const timer = setTimeout(async () => {
      deadline = setTimeout(() => {
        controller.abort();
        if (!disposed) { setError(true); setResults([]); setTotal(0); setLoading(false); }
      }, 18000);
      const params = new URLSearchParams({ q: searchQuery, limit: "20" });
      if (source) params.set("source", source);
      try {
        const response = await fetch(`/api/search?${params}`, { signal: controller.signal });
        if (!response.ok) throw new Error("Search unavailable");
        const payload = await response.json();
        if (disposed || controller.signal.aborted) return;
        setResults(payload.results || []); setTotal(payload.total || 0);
        searchMeta.current = { requestId: payload.requestId, modelVersion: payload.modelVersion };
        trackBehavior("search_performed", { properties: { component: "search", resultCount: payload.total || 0,
          modelVersion: payload.modelVersion, recommendationRequestId: payload.requestId } });
      } catch (err) {
        if (!disposed && !controller.signal.aborted) { setError(true); setResults([]); setTotal(0); }
      } finally {
        clearTimeout(deadline);
        if (!disposed && !controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => { disposed = true; clearTimeout(timer); clearTimeout(deadline); controller.abort(); };
  }, [searchQuery, source, isOpen, composing, retry]);

  const clearSearch = () => { setQuery(""); inputRef.current?.focus(); };
  const chooseTab = (event, index) => {
    const direction = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!direction && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? SOURCE_OPTIONS.length - 1
      : (index + direction + SOURCE_OPTIONS.length) % SOURCE_OPTIONS.length;
    setSource(SOURCE_OPTIONS[next].value);
    dialogRef.current?.querySelectorAll('[role="tab"]')[next]?.focus();
  };

  if (!isOpen || typeof document === "undefined") return null;
  return createPortal(
    <div className={styles.overlay} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="portfolio-search-title" className={styles.panel} data-testid="search-panel">
        <header className={styles.header}>
          <div className={styles.heading}><span className={styles.eyebrow}>YUQI GUO / PORTFOLIO</span><h2 id="portfolio-search-title">Search portfolio</h2></div>
          <div className={styles.searchBox}>
            <Search size={22} aria-hidden="true" />
            <input ref={inputRef} value={query} onChange={event => setQuery(event.target.value)}
              onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)}
              placeholder="Search anything..." aria-label="Search" maxLength={300} autoComplete="off" spellCheck={false}
              onKeyDown={event => { if (event.key === "ArrowDown" && !event.nativeEvent.isComposing) { const result = dialogRef.current?.querySelector('[data-testid="search-result"]'); if (result) { event.preventDefault(); result.focus(); } } }} />
            {query && <button type="button" className={styles.iconButton} onClick={clearSearch} aria-label="Clear search" title="Clear search"><X size={17} aria-hidden="true" /></button>}
          </div>
          <button type="button" onClick={onClose} className={`${styles.iconButton} ${styles.close}`} aria-label="Close search" title="Close search"><X size={21} aria-hidden="true" /></button>
        </header>
        <div className={styles.tabs} role="tablist" aria-label="Content type">
          {SOURCE_OPTIONS.map((option, index) => <button key={option.value} type="button" role="tab" id={`search-tab-${index}`} aria-selected={source === option.value}
            aria-controls="search-content" tabIndex={source === option.value ? 0 : -1} onKeyDown={event => chooseTab(event, index)} onClick={() => setSource(option.value)}>
            <option.icon size={15} aria-hidden="true" />{option.label}
          </button>)}
        </div>
        <div className={styles.body} id="search-content" role="tabpanel" aria-labelledby={`search-tab-${SOURCE_OPTIONS.indexOf(selectedSource)}`} aria-busy={loading}>
          <p className={styles.srOnly} role="status" aria-live="polite">{loading ? "Searching" : error ? "Search unavailable" : searchQuery ? `${total} results` : "Search ready"}</p>
          {loading ? <div className={styles.loading} aria-hidden="true">
            <div className={styles.sectionLabel}>Searching</div>
            {[0, 1, 2].map(i => <div className={styles.skeleton} key={i}><span /><div><span /><span /><span /></div></div>)}
          </div> : error ? <div className={styles.empty}>
            <TriangleAlert size={32} aria-hidden="true" /><h3>Search temporarily unavailable</h3>
            <p>Your search is still here.</p><button type="button" className={styles.action} onClick={() => { setRetry(value => value + 1); inputRef.current?.focus(); }}><RotateCw size={16} aria-hidden="true" />Try again</button>
          </div> : !searchQuery ? <div className={styles.explore}>
            <div className={styles.sectionLabel}>Explore the portfolio</div>
            {COLLECTIONS.map(({ title, detail, url, icon: Icon }) => <a key={url} href={url} onClick={onClose} className={styles.collection}>
              <Icon size={22} aria-hidden="true" /><div><strong>{title}</strong><span>{detail}</span></div><ArrowRight size={18} aria-hidden="true" />
            </a>)}
          </div> : results.length === 0 ? <div className={styles.empty}>
            <SearchX size={34} aria-hidden="true" /><h3>No matches{source ? ` in ${selectedSource.label}` : ""}</h3>
            <p className={styles.emptyQuery}>&ldquo;{searchQuery}&rdquo;</p>
            {source ? <button type="button" className={styles.action} onClick={() => { setSource(""); inputRef.current?.focus(); }}><Search size={16} aria-hidden="true" />Search all content</button>
              : <button type="button" className={styles.action} onClick={clearSearch}><X size={16} aria-hidden="true" />Clear search</button>}
          </div> : <>
            <div className={styles.resultsHeader}><span>{total} {total === 1 ? "result" : "results"}</span><span>Best matches</span></div>
            {results.map(item => <ResultRow key={`${item.source}-${item.id}`} item={item} onNavigate={() => {
              trackBehavior("search_result_clicked", { target: item.url, properties: { component: "search", contentId: item.sourceId,
                contentType: item.sourceTable, rank: item.rank, modelVersion: searchMeta.current.modelVersion,
                recommendationRequestId: searchMeta.current.requestId } });
              onClose();
            }} />)}
          </>}
        </div>
        <footer className={styles.footer}><span>Articles, projects & life</span><span>YUQI.SITE</span></footer>
      </section>
    </div>, document.body
  );
}
