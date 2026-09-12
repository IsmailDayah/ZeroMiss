import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Intercept Arena — ZeroMiss",
  description: "Fly a jet or a quad in 3-D and outlast a battery firing real proportional-navigation interceptors.",
  alternates: { canonical: "/arena" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
