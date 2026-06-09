// pages/admin/blogs/[id].js
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../../../src/components/admin/AdminLayout';
import ContentEditor from '../../../src/components/admin/ContentEditor';
import { writerApi } from '../../../src/lib/writerApi';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

export default function EditBlogPage() {
  const router = useRouter();
  const { id } = router.query;
  const [blog, setBlog] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    writerApi.blogs.get(id)
      .then(setBlog)
      .catch((err) => {
        toast.error(`Failed to load blog: ${err.message}`);
      })
      .finally(() => setLoading(false));
  }, [id]);

  async function handleSave(data, _status) {
    const updated = await writerApi.blogs.update(id, data);
    setBlog(updated);
  }

  if (loading) return <AdminLayout><div style={{ color: '#94a3b8', padding: 40 }}>Loading…</div></AdminLayout>;
  if (!blog) return <AdminLayout><div style={{ color: '#f87171', padding: 40 }}>Blog not found.</div></AdminLayout>;

  return (
    <AdminLayout>
      <ContentEditor
        contentType="blog"
        initialData={blog}
        onSave={handleSave}
        onBack={() => router.push('/admin/blogs')}
      />
      <ToastContainer position="bottom-right" theme="dark" />
    </AdminLayout>
  );
}
