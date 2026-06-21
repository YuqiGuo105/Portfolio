// pages/admin/life-blogs/index.js
import AdminLayout from '../../../src/components/admin/AdminLayout';
import ContentList from '../../../src/components/admin/ContentList';

// Columns map to ContentListItemDto fields. Legacy `status` / `requireLogin` /
// `publishedAt` aren't part of that DTO yet — latestVersion + updatedAt are
// the closest signals available today.
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

export default function LifeBlogsListPage() {
  return (
    <AdminLayout>
      <ContentList
        title="Life Blogs"
        newHref="/admin/life-blogs/new"
        editHref={(id) => `/admin/life-blogs/${id}`}
        type="LIFE_BLOG"
        columns={COLUMNS}
      />
    </AdminLayout>
  );
}
