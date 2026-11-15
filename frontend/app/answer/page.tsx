import type { Metadata } from "next";

import ClientAnswers from "@/components/ClientAnswers";

// The page a client opens with a private link (#114). Not for search engines, and it hands no address to anyone:
// the link's token lives in the fragment, which a browser never sends, and these keep the page itself out of
// results and out of Referer headers (next.config.ts sets the same as response headers).
export const metadata: Metadata = {
  title: "Questions for you · Sual-Cavab",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function AnswerPage() {
  return <ClientAnswers />;
}
