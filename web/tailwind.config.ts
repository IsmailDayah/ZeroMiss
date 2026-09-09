import type { Config } from "tailwindcss";

/**
 * The tactical console design system: deep near-black navy,
 * phosphor-cyan interceptor, warm amber target, white for the moment of truth,
 * red reserved for danger states. Colorblind-safe cyan/amber pairing.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#070b14",
        panel: "#0c1322",
        grid: "#16233a",
        cyan: { DEFAULT: "#37e0e6", dim: "#1d8e93" },
        amber: { DEFAULT: "#ffb454", dim: "#a8742f" },
        danger: "#ff5d5d",
        muted: "#7c8aa5",
        ink: "#f4f8ff",
      },
      fontFamily: {
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        glow: "0 0 24px rgba(55,224,230,0.25)",
        glowAmber: "0 0 24px rgba(255,180,84,0.25)",
      },
      keyframes: {
        sweep: { "0%": { transform: "rotate(0deg)" }, "100%": { transform: "rotate(360deg)" } },
        pulse2: { "0%,100%": { opacity: "0.4" }, "50%": { opacity: "1" } },
      },
      animation: {
        sweep: "sweep 4s linear infinite",
        pulse2: "pulse2 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
