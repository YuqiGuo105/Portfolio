// pages/admin/projects/index.js
import AdminLayout from '../../../src/components/admin/AdminLayout';
import ContentList from '../../../src/components/admin/ContentList';
import { writerApi } from '../../../src/lib/writerApi';

function StatusBadge({ status }) {
  const colors = {
    PUBLISHED: '#4ade80',
    DRAFT: '#94a3b8',
    ARCHIVED: '#f59e0b',
    DELETED: '#f87171',
  };
  return (
    <span style={{
      color: colors[status] || '#94a3b8',
      fontSize: '0.8rem',
      fontWeight: 600,
    }}>
      {status}
    </span>
  );
}

const COLUMNS = [
  { key: 'title', label: 'Title' },
  { key: 'status', label: 'Status', render: (v) => <StatusBadge status={v} /> },
  { key: 'technology', label: 'Technology' },
  { key: 'year', label: 'Year' },
  { key: 'category', label: 'Category' },
];

export default function ProjectsListPage() {
  return (
    <AdminLayout>
      <ContentList
        title="Projects"
        newHref="/admin/projects/new"
        editHref={(id) => `/admin/projects/${id}`}
        api={writerApi.projects}
        columns={COLUMNS}
      />
    </AdminLayout>
  );
}
