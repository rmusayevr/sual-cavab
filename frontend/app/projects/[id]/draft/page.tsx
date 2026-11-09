import { Suspense } from "react";

import DraftScreen from "@/components/DraftScreen";
import { LedgerLoading } from "@/components/ui/Ledger";
import { PageShell } from "@/components/ui/PageShell";

export default function DraftPage() {
  return (
    <PageShell>
      {/* useParams() reads the URL at request time; with cacheComponents the
          build fails unless it sits inside Suspense. */}
      <Suspense fallback={<LedgerLoading label="Loading questions…" />}>
        <DraftScreen />
      </Suspense>
    </PageShell>
  );
}
