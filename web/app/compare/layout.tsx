import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Compare guidance laws — ZeroMiss",
  description: "Run one scenario under two guidance laws side by side, synchronized.",
  alternates: { canonical: "/compare" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
