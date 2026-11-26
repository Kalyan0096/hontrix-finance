import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getLang } from "@/lib/i18n";

export const metadata: Metadata = { title: "Hontrix-PDTR", robots: { index: false, follow: false } };
export const viewport: Viewport = { themeColor: "#0b2a25", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLang();
  return (<html lang={lang}><body>{children}</body></html>);
}
