import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Watch — ZeroMiss",
  description: "Watch a preset interception play out, then tune the guidance law, seeker and airframe live.",
  alternates: { canonical: "/play" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
