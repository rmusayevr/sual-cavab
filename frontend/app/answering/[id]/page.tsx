import type { Metadata } from "next";
import { Suspense } from "react";

import ClientWorkspace from "@/components/ClientWorkspace";
import { LedgerLoading } from "@/components/ui/Ledger";

// The page of a client account for one project (#121). Private to the signed-in person.
export const metadata: Metadata = { title: "Questions for you · Sual-Cavab", robots: { index: false, follow: false } };

export default function AnsweringPage() {
  return (
    // useParams() reads the URL at request time; with cacheComponents the build fails unless it sits inside Suspense.
    <Suspense fallback={<LedgerLoading label="Loading questions…" />}>
      <ClientWorkspace />
    </Suspense>
  );
}
