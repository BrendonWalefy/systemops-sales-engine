import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ViewportHeightFix } from "@/components/viewport-height-fix";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  minimumScale: 1,
  themeColor: "#09090b",
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export const metadata: Metadata = {
  title: "SystemOps",
  description: "Recepcionista autônoma para clínicas",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "SystemOps",
  },
  icons: {
    apple: "/icons/apple-touch-icon.png",
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <ViewportHeightFix />
        {children}
      </body>
    </html>
  );
}
