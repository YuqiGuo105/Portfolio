// pages/admin/life-blogs/index.js
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
  { key: 'category', label: 'Category' },
  { key: 'requireLogin', label: 'Login Required', render: (v) => v ? 'Yes' : 'No' },
  { key: 'publishedAt', label: 'Published', render: (v) => v ? v.slice(0, 10) : '—' },
];

export default function LifeBlogsListPage() {
  return (
    <AdminLayout>
      <ContentList
        title="Life Blogs"
        newHref="/admin/life-blogs/new"
        editHref={(id) => `/admin/life-blogs/${id}`}
        api={writerApi.lifeBlogs}
        columns={COLUMNS}
      />
    </AdminLayout>
  );
}
