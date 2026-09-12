import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Monte Carlo — ZeroMiss",
  description: "Run thousands of randomized engagements in the browser for probability of kill and CEP.",
  alternates: { canonical: "/montecarlo" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
