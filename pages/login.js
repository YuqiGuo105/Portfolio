import { useEffect } from 'react';
import { useRouter } from 'next/router';
import Layout from '../src/layout/Layout';
import AuthDialog from '../src/components/AuthDialog';
import { supabase } from '../src/supabase/supabaseClient';

export default function Login() {
  const router = useRouter();

  useEffect(() => {
    // if user already logged in, redirect immediately
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        const next = router.query.next || '/';
        router.replace(next);
      }
    });
  }, [router]);

  const handleClose = () => {
    const next = router.query.next || '/';
    router.replace(next);
  };

  return (
    <Layout>
      <AuthDialog visible onClose={handleClose} onSuccess={handleClose} />
    </Layout>
  );
}
