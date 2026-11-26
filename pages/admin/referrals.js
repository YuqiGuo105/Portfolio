import { useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import AdminLayout from "../../src/components/admin/AdminLayout";
import { PageHeader, adminStyles as ui } from "../../src/components/admin/AdminUI";
import ReferralInbox from "../../src/components/admin/ReferralInbox";
import { adminApi } from "../../src/lib/adminApi";

export default function ReferralsPage() {
  const [state, setState] = useState({ loading: true, reload: null });
  const api = useMemo(() => adminApi.referrals, []);
  return (
    <AdminLayout>
      <div className={ui.page}>
        <PageHeader
          title="Referral requests"
          subtitle="Requests sent from /talk. The introduction is always the applicant’s own writing. The AI note is a triage aid that only you see; applicants see only where their request stands. A request under the screening bar is declined automatically; one that passes is sent to you. A request you have not touched for 30 days is removed; résumé files go after 30 days or when you close a request."
          actions={(
            <button className={ui.buttonSecondary} onClick={() => state.reload?.()} disabled={state.loading}>
              <RefreshCw size={16} aria-hidden="true" /> Refresh
            </button>
          )}
        />
        <ReferralInbox api={api} onState={setState} />
      </div>
    </AdminLayout>
  );
}
