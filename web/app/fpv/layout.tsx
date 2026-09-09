import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "FPV — ZeroMiss",
  description: "A first-person drone camera over a procedural city, hunted by validated proportional navigation.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
