import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { ExternalLink, Pencil, Plus, Search } from "lucide-react";
import { writerApi } from "../../lib/writerApi";
import { DataState, PageHeader, StatusPill, adminStyles as ui } from "./AdminUI";

export default function ContentList({ title, newHref, editHref, type, columns }) {
  const router = useRouter();
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await writerApi.content.list(type, { limit: 200 });
      setItems((Array.isArray(data?.items) ? data.items : []).map((item) => ({
        ...item,
        id: item.sourceId,
      })));
    } catch (err) {
      setError(err.message || "Content could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [type]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => [item.title, item.summary, item.category, ...(item.tags || [])]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(needle)));
  }, [items, query]);

  return (
    <div className={ui.page}>
      <PageHeader
        title={title}
        subtitle={`${items.length} managed items. Create, edit and publish through the unified content workflow.`}
        actions={(
          <button type="button" className={ui.buttonPrimary} onClick={() => router.push(newHref)}>
            <Plus size={16} /> New {title.replace(/s$/, "")}
          </button>
        )}
      />

      <section className={ui.panel}>
        <div className={ui.toolbar}>
          <div className={ui.searchWrap}>
            <Search className={ui.searchIcon} size={15} aria-hidden="true" />
            <input
              className={ui.input}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${title.toLowerCase()}`}
              aria-label={`Search ${title}`}
            />
          </div>
          <span className={ui.sectionMeta}>{filtered.length} shown</span>
        </div>

        <DataState loading={loading} error={error} empty={!loading && filtered.length === 0} onRetry={load}>
          <div className={ui.tableWrap}>
            <table className={ui.table}>
              <thead>
                <tr>
                  {columns.map((column) => <th key={column.key}>{column.label}</th>)}
                  <th>Indexing</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id}>
                    {columns.map((column, index) => (
                      <td key={column.key} className={index === 0 ? ui.primaryCell : ""}>
                        {column.render ? column.render(item[column.key], item) : (item[column.key] ?? "—")}
                      </td>
                    ))}
                    <td>
                      <div className={ui.toolbarGroup}>
                        <StatusPill value={item.ragStatus || "pending"} />
                        <StatusPill value={item.searchStatus || "pending"} />
                      </div>
                    </td>
                    <td>
                      <div className={ui.toolbarGroup}>
                        {item.url && (
                          <a className={ui.iconButton} href={item.url} target="_blank" rel="noreferrer" title="Open published page" aria-label="Open published page">
                            <ExternalLink size={15} />
                          </a>
                        )}
                        <button className={ui.iconButton} type="button" onClick={() => router.push(editHref(item.id))} title="Edit content" aria-label={`Edit ${item.title}`}>
                          <Pencil size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DataState>
      </section>
    </div>
  );
}
