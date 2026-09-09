import type { Metadata, Viewport } from "next";
import { Inter, Archivo } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { Toaster } from "sonner";
import { CookieConsent } from "@/components/shared/CookieConsent";
import { OfflineIndicator } from "@/components/shared/OfflineIndicator";
import { config } from "@/lib/config";
import { CursorLayer } from "@/components/motion/CursorLayer";
import { Preloader } from "@/components/motion/Preloader";

// Both faces are self-hosted by next/font — no third-party request, no layout shift,
// and they still resolve inside the offline Capacitor build.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

// Archivo carries the display voice: industrial, editorial, and far less worn than
// the Inter/Jakarta pairing that every generated SaaS page ships with.
const archivo = Archivo({
  subsets: ["latin"],
  weight: ["600", "700", "800", "900"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(config.app.url),
  title: {
    default: `${config.app.name} — Equipment inspections, certified safe`,
    template: `%s · ${config.app.name}`,
  },
  description:
    "Identify equipment with AI, run dynamic safety checklists, capture GPS-tagged evidence, and generate OSHA-ready inspection reports from a phone.",
  manifest: "/manifest.json",
  applicationName: config.app.name,
  openGraph: {
    type: "website",
    siteName: config.app.name,
    url: config.app.url,
    title: `${config.app.name} — Equipment inspections, certified safe`,
    description:
      "AI equipment identification, dynamic safety checklists, GPS-tagged evidence and OSHA-ready reports.",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: config.app.name }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${config.app.name} — Equipment inspections, certified safe`,
    description:
      "AI equipment identification, dynamic safety checklists, GPS-tagged evidence and OSHA-ready reports.",
    images: ["/og.png"],
  },
  icons: {
    icon: "/icon.svg",
    apple: "/apple-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Pinch-zoom stays enabled. Blocking it fails WCAG 1.4.4 and buys nothing —
  // the Capacitor shell does not need it disabled.
  maximumScale: 5,
  userScalable: true,
  themeColor: "#100f0e",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${archivo.variable}`}>
      {/*
        No viewport lock here. The authenticated shell (AppLayout) locks its own
        100dvh viewport; locking the document as well would leave marketing pages
        scrolling inside a nested div, which breaks every scroll-driven timeline.
      */}
      <body className="antialiased">
        {/*
          Scroll-reveal fallback for browsers without CSS scroll-driven animation.

          Checked 2026-09-09: Firefox stable still ships `animation-timeline` behind
          `layout.css.scroll-driven-animations.enabled`, so roughly a sixth of visitors
          were being served a completely static page while everyone else got the reveals.
          It is an Interop 2026 target and will land on its own, at which point the
          `CSS.supports` check below stops matching and this code does nothing.

          Deliberately an inline script rather than a component:

          * it runs during parse, so there is no hydration flash of content appearing,
            then hiding, then animating back in;
          * the hidden state is applied by a class this script adds, so if scripting is
            off — or this script throws — nothing is ever hidden. Content-visible is the
            failure mode, which is the only acceptable one;
          * the watchdog re-shows anything still hidden after three seconds, so a browser
            that lacks IntersectionObserver, or an element that never intersects, can
            never strand copy off screen.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{
if(CSS.supports('animation-timeline','view()'))return;
if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
if(!('IntersectionObserver' in window))return;
var d=document,r=d.documentElement;r.classList.add('sda-fallback');
function go(){
var els=d.querySelectorAll('.sc-rise,.sc-fade');
var io=new IntersectionObserver(function(es){es.forEach(function(e){
if(e.isIntersecting){e.target.classList.add('sda-in');io.unobserve(e.target);}});},
{rootMargin:'0px 0px -12% 0px'});
els.forEach(function(el){io.observe(el);});
setTimeout(function(){els.forEach(function(el){el.classList.add('sda-in');});},3000);
}
if(d.readyState==='loading')d.addEventListener('DOMContentLoaded',go);else go();
}catch(e){document.documentElement.classList.remove('sda-fallback');}})();`,
          }}
        />
        <AuthProvider>
          {/* Both are additive chrome: rendered by React, so with JavaScript off neither
              exists and the page is untouched. Neither ever hides content. */}
          <Preloader />
          <CursorLayer />
          {children}
          <CookieConsent />
          <OfflineIndicator />
          <Toaster
            position="top-right"
            toastOptions={{
              className: "font-sans",
              style: { borderRadius: "0.625rem" },
            }}
          />
        </AuthProvider>
      </body>
    </html>
  );
}
