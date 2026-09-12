import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Learn — ZeroMiss",
  description: "From frisbees to missiles: why holding the bearing constant makes you collide.",
  alternates: { canonical: "/learn" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
