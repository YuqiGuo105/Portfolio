// pages/admin/blogs/new.js
import { useRouter } from 'next/router';
import AdminLayout from '../../../src/components/admin/AdminLayout';
import ContentEditor from '../../../src/components/admin/ContentEditor';
import { writerApi } from '../../../src/lib/writerApi';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

export default function NewBlogPage() {
  const router = useRouter();

  async function handleSave(data, _status, idempotencyKey) {
    await writerApi.blogs.create(data, idempotencyKey);
    router.push('/admin/blogs');
  }

  return (
    <AdminLayout>
      <ContentEditor
        contentType="blog"
        initialData={null}
        onSave={handleSave}
        onBack={() => router.push('/admin/blogs')}
      />
      <ToastContainer position="bottom-right" theme="dark" />
    </AdminLayout>
  );
}
