import { useMemo } from "react";
import AdminLayout from "../../src/components/admin/AdminLayout";
import { PageHeader, adminStyles as ui } from "../../src/components/admin/AdminUI";
import WorkHistory from "../../src/components/admin/WorkHistory";
import { adminApi } from "../../src/lib/adminApi";
import { writerApi } from "../../src/lib/writerApi";

// The work history is the single place the site learns the current employer from.
export default function ExperiencePage() {
  const api = useMemo(() => ({ ...writerApi.experience, refresh: () => adminApi.referrals.offer({ action: "refresh" }) }), []);
  return (
    <AdminLayout>
      <div className={ui.page}>
        <PageHeader
          title="Work history"
          subtitle="Record a job change here once. The home page, the referral form, structured data, llms.txt, search and the assistant’s knowledge follow this list; nothing else needs editing."
        />
        <WorkHistory api={api} />
      </div>
    </AdminLayout>
  );
}
