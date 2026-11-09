import { Suspense } from "react";

import QuestionsScreen from "@/components/QuestionsScreen";
import { LedgerLoading } from "@/components/ui/Ledger";
import { PageShell } from "@/components/ui/PageShell";

export default function QuestionsPage() {
  return (
    <PageShell>
      {/* useParams() reads the URL at request time; with cacheComponents the
          build fails unless it sits inside Suspense. */}
      <Suspense fallback={<LedgerLoading label="Loading questions…" />}>
        <QuestionsScreen />
      </Suspense>
    </PageShell>
  );
}
