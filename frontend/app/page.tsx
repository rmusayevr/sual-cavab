import type { Metadata } from "next";

import Landing from "@/components/Landing";

export const metadata: Metadata = {
  title: "Sual-Cavab — track the questions your project is waiting on",
  description: "Keep every open client question in one place: numbered, with a clear status, until it is answered.",
  openGraph: {
    title: "Sual-Cavab — track open project questions",
    description: "Numbered questions, clear statuses, and one number per project for what is still open.",
  },
};

export default function HomePage() {
  return <Landing />;
}
