// pages/admin/blogs/index.js
import AdminLayout from '../../../src/components/admin/AdminLayout';
import ContentList from '../../../src/components/admin/ContentList';

// Columns map to ContentListItemDto fields returned by /api/admin/content.
// (Legacy `status` / `publishedAt` aren't part of that DTO; latestVersion +
// updatedAt are the closest signals available today.)
const COLUMNS = [
  { key: 'title', label: 'Title' },
  { key: 'category', label: 'Category' },
  { key: 'latestVersion', label: 'Version', render: (v) => (v ?? '—') },
  {
    key: 'updatedAt',
    label: 'Updated',
    render: (v) => (typeof v === 'string' ? v.slice(0, 10) : '—'),
  },
];

export default function BlogsListPage() {
  return (
    <AdminLayout>
      <ContentList
        title="Blogs"
        newHref="/admin/blogs/new"
        editHref={(id) => `/admin/blogs/${id}`}
        type="BLOG"
        columns={COLUMNS}
      />
    </AdminLayout>
  );
}
