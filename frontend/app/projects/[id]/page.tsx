import { Suspense } from "react";

import Workspace from "@/components/Workspace";
import { LedgerLoading } from "@/components/ui/Ledger";

export default function ProjectPage() {
  return (
    // useParams() reads the URL at request time; with cacheComponents the build fails unless it sits inside Suspense.
    <Suspense fallback={<LedgerLoading label="Loading project…" />}>
      <Workspace />
    </Suspense>
  );
}
