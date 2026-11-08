import { Suspense } from "react";

import DraftScreen from "@/components/DraftScreen";

export default function DraftPage() {
  return (
    <main style={{ padding: "2rem", maxWidth: "40rem" }}>
      {/* useParams() reads the URL at request time; with cacheComponents the
          build fails unless it sits inside Suspense. */}
      <Suspense fallback={<p>Loading questions…</p>}>
        <DraftScreen />
      </Suspense>
    </main>
  );
}
