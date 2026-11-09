import type { Metadata } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

// Inter has the letters Azerbaijani needs (ə ğ ı ö ü ş ç); they live in the
// latin-ext subset, so both subsets are loaded (#53). Self-hosted by Next.js at
// build time: the browser makes no request to Google.
const inter = Inter({ subsets: ["latin", "latin-ext"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "Sual-Cavab",
  description: "Track the questions your project is waiting on.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
