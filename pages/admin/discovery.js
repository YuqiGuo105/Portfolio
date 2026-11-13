import AdminLayout from '../../src/components/admin/AdminLayout';
import DiscoveryPanel from '../../src/components/admin/DiscoveryPanel';
import { adminApi } from '../../src/lib/adminApi';

export default function DiscoveryPage() {
  return <AdminLayout><DiscoveryPanel request={adminApi.discovery.request} /></AdminLayout>;
}
