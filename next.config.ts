import type { NextConfig } from "next";

const isGitHubPages = process.env.GITHUB_PAGES === "true";
const pagesBasePath = isGitHubPages ? "/Watch-with-me" : "";

const nextConfig: NextConfig = {
  basePath: pagesBasePath || undefined,
  assetPrefix: pagesBasePath || undefined,
};

export default nextConfig;
