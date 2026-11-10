import { Suspense } from "react";

import ProjectDetail from "@/components/ProjectDetail";
import { LedgerLoading } from "@/components/ui/Ledger";
import { PageShell } from "@/components/ui/PageShell";

export default function ProjectPage() {
  return (
    <PageShell>
      {/* useParams() reads the URL at request time; with cacheComponents the
          build fails unless it sits inside Suspense. */}
      <Suspense fallback={<LedgerLoading label="Loading project…" />}>
        <ProjectDetail />
      </Suspense>
    </PageShell>
  );
}
