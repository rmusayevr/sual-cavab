import { Suspense } from "react";

import ProjectDetail from "@/components/ProjectDetail";
import { PageShell } from "@/components/ui/PageShell";

export default function ProjectPage() {
  return (
    <PageShell>
      {/* useParams() reads the URL at request time; with cacheComponents the
          build fails unless it sits inside Suspense. */}
      <Suspense fallback={<p className="text-muted-foreground">Loading project…</p>}>
        <ProjectDetail />
      </Suspense>
    </PageShell>
  );
}
