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
  metadataBase: new URL("https://app.systemops.com.br"),
  title: "SystemOps",
  description: "Recepcionista autônoma para clínicas",
  // O app SaaS é protegido por autenticação — não deve ser indexado.
  // O site público está em systemops.com.br (systemops-landing).
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
    },
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "SystemOps",
  },
  icons: {
    apple: "/icons/apple-touch-icon.png",
    icon: "/icons/icon-192.png",
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
