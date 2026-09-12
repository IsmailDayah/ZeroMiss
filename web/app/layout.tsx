import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Inter } from "next/font/google";

import "./globals.css";
import { NavBar } from "@/components/NavBar";
import { SITE_URL } from "@/lib/site";

const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "ZeroMiss — The Interception Lab",
  description:
    "A validated missile-guidance simulator you can play in your browser. The same math a falcon, an outfielder, and a homing missile all use: keep the bearing constant and you collide.",
  openGraph: {
    title: "ZeroMiss — The Interception Lab",
    description:
      "Textbook-exact proportional navigation, cross-validated Python↔TypeScript, rendered as a cinematic intercept theatre.",
    type: "website",
    images: [{ url: "/og.png", width: 1170, height: 780, alt: "A ZeroMiss interception" }],
  },
  metadataBase: new URL(SITE_URL),
  // Without a canonical each page inherits nothing and search engines have
  // to guess; every route below declares its own.
  alternates: { canonical: "/" },
};

export const viewport: Viewport = {
  themeColor: "#070b14",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <NavBar />
        <main className="mx-auto w-full max-w-7xl px-4 pb-24 pt-4">{children}</main>
      </body>
    </html>
  );
}
