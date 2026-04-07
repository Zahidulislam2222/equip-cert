import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { Toaster } from "sonner";
import { CookieConsent } from "@/components/shared/CookieConsent";
import { OfflineIndicator } from "@/components/shared/OfflineIndicator";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "EquipCert AI",
  description: "AI-Powered Equipment Safety Compliance Platform",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#0f172a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.className} antialiased`}>
        <AuthProvider>
          <div className="flex h-[100dvh] w-full flex-col overflow-hidden">
            {children}
          </div>
          <CookieConsent />
          <OfflineIndicator />
          <Toaster
            position="top-right"
            toastOptions={{
              className: 'font-sans',
              style: { borderRadius: '0.75rem' },
            }}
          />
        </AuthProvider>
      </body>
    </html>
  );
}
