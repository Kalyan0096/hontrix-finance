import type { NextConfig } from "next";
import { contentSecurityPolicy } from "./src/lib/security";

const isProd = process.env.NODE_ENV === "production";
// The page policy starts in "report only" mode (the browser logs what it would block, nothing breaks).
// After checking the browser console on the live site, set CSP_ENFORCE=1 to enforce it.
const cspHeader = process.env.CSP_ENFORCE === "1" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only";

const config: NextConfig = {
  poweredByHeader: false,
  outputFileTracingRoot: process.cwd(),
  async headers() {
    return [{ source: "/(.*)", headers: [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=()" },
      ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
      { key: cspHeader, value: contentSecurityPolicy(isProd) },
    ] }];
  },
};
export default config;
