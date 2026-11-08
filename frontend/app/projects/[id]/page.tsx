import { Suspense } from "react";

import ProjectDetail from "@/components/ProjectDetail";

export default function ProjectPage() {
  return (
    <main style={{ padding: "2rem", maxWidth: "40rem" }}>
      {/* useParams() reads the URL at request time; with cacheComponents the
          build fails unless it sits inside Suspense. */}
      <Suspense fallback={<p>Loading project…</p>}>
        <ProjectDetail />
      </Suspense>
    </main>
  );
}
