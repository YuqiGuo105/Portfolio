import Layout from '../src/layout/Layout';
import AuthDialog from '../src/components/AuthDialog';
import { useRouter } from 'next/router';

export default function LoginPage() {
  const router = useRouter();
  const next = router.query.next || '/';
  return (
    <Layout>
      <AuthDialog next={next} onClose={() => router.replace('/')} />
    </Layout>
  );
}
