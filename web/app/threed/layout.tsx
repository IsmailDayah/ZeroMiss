import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "3-D engagement — ZeroMiss",
  description: "True 3-D proportional navigation against an out-of-plane climbing or barrelling target.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
