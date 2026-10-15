import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppNav } from "@/components/app-nav";
import { Providers } from "@/components/providers";
import { SessionGate } from "@/components/session/session-gate";
import { UtilityBar } from "@/components/session/utility-bar";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FleetOps · Marine Work Orders",
  description: "Vessel-scoped work orders, crew management and multi-role review for a cruise fleet.",
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-slate-50 text-slate-900">
        <Providers>
          <UtilityBar />
          <AppNav />
          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
            <SessionGate>{children}</SessionGate>
          </main>
        </Providers>
      </body>
    </html>
  );
}
