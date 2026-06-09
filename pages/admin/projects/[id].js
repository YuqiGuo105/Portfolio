// pages/admin/projects/[id].js
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../../../src/components/admin/AdminLayout';
import ContentEditor from '../../../src/components/admin/ContentEditor';
import { writerApi } from '../../../src/lib/writerApi';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

export default function EditProjectPage() {
  const router = useRouter();
  const { id } = router.query;
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    writerApi.projects.get(id)
      .then(setProject)
      .catch((err) => {
        toast.error(`Failed to load project: ${err.message}`);
      })
      .finally(() => setLoading(false));
  }, [id]);

  async function handleSave(data, _status) {
    const updated = await writerApi.projects.update(id, data);
    setProject(updated);
  }

  if (loading) return <AdminLayout><div style={{ color: '#94a3b8', padding: 40 }}>Loading…</div></AdminLayout>;
  if (!project) return <AdminLayout><div style={{ color: '#f87171', padding: 40 }}>Project not found.</div></AdminLayout>;

  return (
    <AdminLayout>
      <ContentEditor
        contentType="project"
        initialData={project}
        onSave={handleSave}
        onBack={() => router.push('/admin/projects')}
      />
      <ToastContainer position="bottom-right" theme="dark" />
    </AdminLayout>
  );
}
