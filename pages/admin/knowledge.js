import AdminLayout from '../../src/components/admin/AdminLayout';
import KnowledgeManager from '../../src/components/admin/KnowledgeManager';
import { knowledgeReadOnlyPreview } from '../../src/lib/writerApi';

export default function KnowledgePage() {
  return <AdminLayout requiredPermission="operations.manage"><KnowledgeManager readOnly={knowledgeReadOnlyPreview} /></AdminLayout>;
}
