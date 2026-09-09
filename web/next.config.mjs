/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The app is fully static (no backend) — exportable to Vercel's edge / any CDN.
  output: "export",
  images: { unoptimized: true },
  eslint: { ignoreDuringBuilds: true },
  transpilePackages: ["three"],
};

export default nextConfig;
