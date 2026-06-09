// src/components/admin/AdminTokenGate.js
// Wraps any admin page. Redirects to /admin/login if no token is stored.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';

export default function AdminTokenGate({ children }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = sessionStorage.getItem('admin_token');
    if (!token) {
      router.replace('/admin/login');
    } else {
      setReady(true);
    }
  }, [router]);

  if (!ready) return null;
  return children;
}
