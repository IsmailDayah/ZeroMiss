import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Replay — ZeroMiss",
  description: "Replay a specific engagement from its seed.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
