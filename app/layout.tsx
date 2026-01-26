import type { Metadata, Viewport } from "next";
import { Source_Sans_3 } from "next/font/google";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { ClientLayout } from "@/components/ClientLayout";
import "./globals.css";

const sourceSans = Source_Sans_3({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "PiJam Assessment",
  description: "Submit and complete assessments offline or online",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "PiJam Assessment",
  },
};

export const viewport: Viewport = {
  themeColor: "#ff4b4b",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${sourceSans.variable} antialiased`}>
        <ServiceWorkerRegister />
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  );
}


