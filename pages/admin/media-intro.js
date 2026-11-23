import { useRouter } from 'next/router';
import AdminLayout from '../../src/components/admin/AdminLayout';
import IntroductionManager from '../../src/components/media/IntroductionManager';
import { validJobId } from '../../src/lib/media/presentationJobs.mjs';

export default function MediaIntroductionPage() {
  const router = useRouter();
  const selected = validJobId(router.query.job) ? router.query.job : null;
  return <AdminLayout requiredPermission="operations.manage">{router.isReady && <IntroductionManager key={selected || 'new'} jobId={selected}
    onSelect={id => router.replace(id ? `/admin/media-intro?job=${encodeURIComponent(id)}` : '/admin/media-intro', undefined, { shallow: true })} />}</AdminLayout>;
}
