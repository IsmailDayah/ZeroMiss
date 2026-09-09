import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Tracker in the Loop — ZeroMiss",
  description: "A radar EKF and IMM estimate a noisy track - estimation and sensor fusion, visualized.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
