import type { Metadata } from "next";

import ProjectList from "@/components/ProjectList";

export const metadata: Metadata = { title: "Projects · Sual-Cavab" };

export default function ProjectsPage() {
  return (
    <main style={{ padding: "2rem", maxWidth: "40rem" }}>
      <h1>Your projects</h1>
      <ProjectList />
    </main>
  );
}
