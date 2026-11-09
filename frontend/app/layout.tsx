import type { Metadata } from "next";
import { Fraunces, JetBrains_Mono, Manrope } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

// The three fonts of the design (DESIGN.md): Fraunces for headings, Manrope for text, JetBrains
// Mono for ids, counts and status words. The Azerbaijani letters (ə ğ ı ö ü ş ç) live in the
// latin-ext subset, so both subsets are loaded. Self-hosted by Next.js at build time: the browser
// makes no request to Google. No other font is used.
const fraunces = Fraunces({ subsets: ["latin", "latin-ext"], axes: ["opsz"], variable: "--font-fraunces", display: "swap" });
const manrope = Manrope({ subsets: ["latin", "latin-ext"], variable: "--font-manrope", display: "swap" });
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin", "latin-ext"],
  weight: "500",
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Sual-Cavab",
  description: "Track the questions your project is waiting on.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${manrope.variable} ${jetbrainsMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
