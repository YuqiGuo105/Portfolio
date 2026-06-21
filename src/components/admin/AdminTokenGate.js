// src/components/admin/AdminTokenGate.js
// Wraps any admin page. Redirects to /admin/login if no Supabase session.
//
// This replaced the legacy `sessionStorage.admin_token` check — the admin
// panel now relies on the same Supabase session that the rest of the site
// uses, and the admin-service validates the JWT + email allow-list server-side.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '../../supabase/supabaseClient';

export default function AdminTokenGate({ children }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;

    const redirectToLogin = () => {
      const target = router.asPath || '/admin';
      router.replace(`/admin/login?redirect=${encodeURIComponent(target)}`);
    };

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        if (data?.session) {
          setReady(true);
        } else {
          redirectToLogin();
        }
      })
      .catch(() => {
        if (active) redirectToLogin();
      });

    const { data: authListener } = supabase.auth.onAuthStateChange((event) => {
      if (!active) return;
      if (event === 'SIGNED_OUT') {
        setReady(false);
        redirectToLogin();
      }
    });

    return () => {
      active = false;
      authListener?.subscription?.unsubscribe?.();
    };
  }, [router]);

  if (!ready) return null;
  return children;
}
