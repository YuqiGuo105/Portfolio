// pages/admin/life-blogs/new.js
import { useRouter } from 'next/router';
import AdminLayout from '../../../src/components/admin/AdminLayout';
import ContentEditor from '../../../src/components/admin/ContentEditor';
import { writerApi } from '../../../src/lib/writerApi';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

export default function NewLifeBlogPage() {
  const router = useRouter();

  async function handleSave(data, _status, idempotencyKey) {
    await writerApi.lifeBlogs.create(data, idempotencyKey);
    router.push('/admin/life-blogs');
  }

  return (
    <AdminLayout>
      <ContentEditor
        contentType="life-blog"
        initialData={null}
        onSave={handleSave}
        onBack={() => router.push('/admin/life-blogs')}
      />
      <ToastContainer position="bottom-right" theme="dark" />
    </AdminLayout>
  );
}
