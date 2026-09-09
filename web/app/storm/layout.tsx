import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Storm — ZeroMiss",
  description: "A salvo: many interceptors against many evaders under mixed guidance laws.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
