import type { Metadata } from "next";

import ProjectList from "@/components/ProjectList";
import { PageShell } from "@/components/ui/PageShell";

export const metadata: Metadata = { title: "Projects · Sual-Cavab" };

export default function ProjectsPage() {
  return (
    <PageShell title="Your projects">
      <ProjectList />
    </PageShell>
  );
}
