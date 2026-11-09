import SessionStatus from "@/components/SessionStatus";
import { PageShell } from "@/components/ui/PageShell";

export default function HomePage() {
  return (
    <PageShell title="Sual-Cavab">
      <p className="text-muted">Track the questions your project is waiting on.</p>
      <SessionStatus />
    </PageShell>
  );
}
