import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Save, UserPlus } from "lucide-react";
import AdminLayout from "../../src/components/admin/AdminLayout";
import { DataState, PageHeader, StatusPill, adminStyles as ui } from "../../src/components/admin/AdminUI";
import { writerApi } from "../../src/lib/writerApi";

const ROLES = ["EDITOR", "PUBLISHER", "ADMIN"];
const STATUSES = ["ACTIVE", "SUSPENDED"];

export default function AdminUsersPage() {
  return (
    <AdminLayout requiredPermission="admin.users.manage">
      <AdminUsersContent />
    </AdminLayout>
  );
}

function AdminUsersContent() {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ email: "", role: "EDITOR", status: "ACTIVE", displayName: "", note: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await writerApi.adminUsers.list({ limit: 100 });
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (err) {
      setError(err.message || "Admin users could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await writerApi.adminUsers.upsert(form);
      setForm({ email: "", role: "EDITOR", status: "ACTIVE", displayName: "", note: "" });
      await load();
    } catch (err) {
      setError(err.message || "Admin user could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(user, status) {
    if (status === user.status) return;
    const ok = window.confirm(`Change ${user.email} to ${status}?`);
    if (!ok) return;
    setError("");
    try {
      await writerApi.adminUsers.updateStatus(user.id, status, `Status changed from admin users page`);
      await load();
    } catch (err) {
      setError(err.message || "Admin user status could not be updated.");
    }
  }

  return (
    <div className={ui.page}>
        <PageHeader
          title="Admin users"
          subtitle="Manage admin access from the database. Suspended users are retained for audit history."
          actions={(
            <button type="button" className={ui.buttonSecondary} onClick={load} disabled={loading}>
              <RefreshCw size={15} /> Refresh
            </button>
          )}
        />

        {error && <div className={ui.errorBanner}>{error}</div>}

        <section className={ui.panel}>
          <div className={ui.toolbar}>
            <div className={ui.toolbarGroup}><UserPlus size={17} /><strong>Add or update user</strong></div>
          </div>
          <form onSubmit={submit} style={{ display: "grid", gap: 14, padding: 18 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
              <input className={ui.input} value={form.email} placeholder="email@example.com" required
                onChange={(e) => setForm({ ...form, email: e.target.value })} />
              <select className={ui.select} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
              </select>
              <select className={ui.select} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
              <input className={ui.input} value={form.displayName} placeholder="Display name"
                onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
              <input className={ui.input} value={form.note} placeholder="Reason / note"
                onChange={(e) => setForm({ ...form, note: e.target.value })} />
              <button className={ui.buttonPrimary} type="submit" disabled={saving}>
                <Save size={15} /> Save
              </button>
            </div>
          </form>
        </section>

        <section className={ui.panel}>
          <DataState loading={loading} error={!items.length ? error : ""} empty={!loading && !error && items.length === 0} onRetry={load}>
            <div className={ui.tableWrap}>
              <table className={ui.table}>
                <thead>
                  <tr><th>User</th><th>Role</th><th>Status</th><th>Last login</th><th>Updated by</th><th>Manage</th></tr>
                </thead>
                <tbody>
                  {items.map((user) => (
                    <tr key={user.id}>
                      <td>
                        <div className={ui.primaryCell}>{user.email}</div>
                        <div className={ui.secondaryCell}>{user.displayName || user.note || user.id}</div>
                      </td>
                      <td><StatusPill value={user.role} /></td>
                      <td><StatusPill value={user.status} /></td>
                      <td>{formatDate(user.lastLoginAt)}</td>
                      <td>{user.updatedBy || user.createdBy || "—"}</td>
                      <td>
                        <select className={ui.select} value={user.status} onChange={(e) => changeStatus(user, e.target.value)}>
                          {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                        </select>
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

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}
