import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Duel — ZeroMiss",
  description: "You fly the jet and try to evade a proportional-navigation interceptor.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
