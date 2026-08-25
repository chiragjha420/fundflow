import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { QueryProvider } from "@/providers/query-provider";
import { SyncProvider } from "@/providers/sync-provider";
import { PWARegistrar } from "@/components/pwa-registrar";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "JBB FundFlow",
  description: "Manufacturing Cash Disbursement & Reconciliation Ledger",
  manifest: "/manifest.json",
  icons: {
    icon: "/icon.png",
    apple: "/icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#f8fafc",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full bg-slate-50">
      <body className={`${inter.className} h-full antialiased text-slate-900`}>
        <QueryProvider>
          <SyncProvider>
            <PWARegistrar />
            {children}
          </SyncProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
