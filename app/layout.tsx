import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "EquipCert AI",
  description: "Field Inspection Platform",
  manifest: "/manifest.json", // Good practice for PWAs/Android
};

// This forces the mobile browser to behave like a Native App
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false, // Disables zooming
  themeColor: "#0f172a", // Matches your sidebar color
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.className} antialiased`}>
        {/* Main App Container */}
        <div className="flex h-[100dvh] w-full flex-col overflow-hidden">
          {children}
        </div>
      </body>
    </html>
  );
}