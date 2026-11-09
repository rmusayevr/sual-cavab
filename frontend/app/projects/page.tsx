import type { Metadata } from "next";

import ProjectList from "@/components/ProjectList";
import { AppHeader } from "@/components/ui/AppHeader";

export const metadata: Metadata = { title: "Projects · Sual-Cavab" };

// A page the design example does not show (#72): the navy header band of the landing page, a carpet
// seam, then the projects as lines of a ledger.
export default function ProjectsPage() {
  return (
    <div className="min-h-screen">
      <AppHeader eyebrow="Ledger" title="Your projects">
        <p>Every client project you are on, with what it is still waiting for.</p>
      </AppHeader>
      <main className="mx-auto w-full max-w-6xl px-6 py-10">
        <ProjectList />
      </main>
    </div>
  );
}
