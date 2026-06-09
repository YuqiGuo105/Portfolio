// pages/admin/life-blogs/[id].js
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../../../src/components/admin/AdminLayout';
import ContentEditor from '../../../src/components/admin/ContentEditor';
import { writerApi } from '../../../src/lib/writerApi';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

export default function EditLifeBlogPage() {
  const router = useRouter();
  const { id } = router.query;
  const [lifeBlog, setLifeBlog] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    writerApi.lifeBlogs.get(id)
      .then(setLifeBlog)
      .catch((err) => {
        toast.error(`Failed to load life blog: ${err.message}`);
      })
      .finally(() => setLoading(false));
  }, [id]);

  async function handleSave(data, _status) {
    const updated = await writerApi.lifeBlogs.update(id, data);
    setLifeBlog(updated);
  }

  if (loading) return <AdminLayout><div style={{ color: '#94a3b8', padding: 40 }}>Loading…</div></AdminLayout>;
  if (!lifeBlog) return <AdminLayout><div style={{ color: '#f87171', padding: 40 }}>Life blog not found.</div></AdminLayout>;

  return (
    <AdminLayout>
      <ContentEditor
        contentType="life-blog"
        initialData={lifeBlog}
        onSave={handleSave}
        onBack={() => router.push('/admin/life-blogs')}
      />
      <ToastContainer position="bottom-right" theme="dark" />
    </AdminLayout>
  );
}
