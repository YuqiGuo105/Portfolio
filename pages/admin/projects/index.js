// pages/admin/projects/index.js
import AdminLayout from '../../../src/components/admin/AdminLayout';
import ContentList from '../../../src/components/admin/ContentList';

// Columns map to ContentListItemDto fields. Legacy `status` / `technology` /
// `year` aren't part of that DTO yet — category + latestVersion + updatedAt
// are the closest signals available today.
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

export default function ProjectsListPage() {
  return (
    <AdminLayout>
      <ContentList
        title="Projects"
        newHref="/admin/projects/new"
        editHref={(id) => `/admin/projects/${id}`}
        type="PROJECT"
        columns={COLUMNS}
      />
    </AdminLayout>
  );
}
