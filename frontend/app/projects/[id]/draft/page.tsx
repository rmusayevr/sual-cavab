import { Suspense } from "react";

import DraftScreen from "@/components/DraftScreen";
import { PageShell } from "@/components/ui/PageShell";

export default function DraftPage() {
  return (
    <PageShell>
      {/* useParams() reads the URL at request time; with cacheComponents the
          build fails unless it sits inside Suspense. */}
      <Suspense fallback={<p className="text-muted-foreground">Loading questions…</p>}>
        <DraftScreen />
      </Suspense>
    </PageShell>
  );
}
