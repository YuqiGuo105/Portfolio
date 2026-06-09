// pages/admin/projects/new.js
import { useRouter } from 'next/router';
import AdminLayout from '../../../src/components/admin/AdminLayout';
import ContentEditor from '../../../src/components/admin/ContentEditor';
import { writerApi } from '../../../src/lib/writerApi';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

export default function NewProjectPage() {
  const router = useRouter();

  async function handleSave(data, _status, idempotencyKey) {
    await writerApi.projects.create(data, idempotencyKey);
    router.push('/admin/projects');
  }

  return (
    <AdminLayout>
      <ContentEditor
        contentType="project"
        initialData={null}
        onSave={handleSave}
        onBack={() => router.push('/admin/projects')}
      />
      <ToastContainer position="bottom-right" theme="dark" />
    </AdminLayout>
  );
}
