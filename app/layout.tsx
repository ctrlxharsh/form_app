import type { Metadata, Viewport } from "next";
import { Outfit } from "next/font/google";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { ClientLayout } from "@/components/ClientLayout";
import "./globals.css";

const outfit = Outfit({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  preload: false,
});

export const metadata: Metadata = {
  title: "PiJam Assessment Portal",
  description: "Submit and complete assessments offline or online",
  icons: {
    icon: "/pijamLogo.svg",
    shortcut: "/pijamLogo.svg",
    apple: "/pijamLogo.svg",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "PiJam Assessment Portal",
  },
};

export const viewport: Viewport = {
  themeColor: "#1b2b4e",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200" />
      </head>
      <body className={`${outfit.variable} antialiased`}>
        <ServiceWorkerRegister />
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  );
}


