import type { Metadata } from "next";

import Landing from "@/components/Landing";

export const metadata: Metadata = {
  title: "Sual-Cavab — track the questions your project is waiting on",
  description: "Keep every open client question in one place and draft short Azerbaijani messages with English tech terms.",
  openGraph: {
    title: "Sual-Cavab — track open project questions",
    description: "Numbered questions, clear statuses, and drafted client messages in Azerbaijani.",
  },
};

export default function HomePage() {
  return <Landing />;
}
