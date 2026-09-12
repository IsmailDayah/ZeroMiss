import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Storm — ZeroMiss",
  description: "A salvo: many interceptors against many evaders under mixed guidance laws.",
  alternates: { canonical: "/storm" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
