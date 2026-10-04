import type { Metadata, Viewport } from "next";
import { RegisterSW } from "@/components/RegisterSW";
import "@fontsource-variable/inter";
import "@fontsource-variable/source-serif-4";
import "@fontsource-variable/source-serif-4/wght-italic.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "EBD — Escola Bíblica Dominical",
  description: "Controle de presença, escala, relatórios e material didático da EBD.",
  applicationName: "EBD",
  appleWebApp: { capable: true, title: "EBD", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        {children}
        <RegisterSW />
      </body>
    </html>
  );
}
