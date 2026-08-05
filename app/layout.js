import "./globals.css";
import RegisterServiceWorker from "./components/RegisterServiceWorker";

export const metadata = {
  title: "GOLD PULSE X v11 Pattern Intelligence 5M",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "GOLD PULSE" },
  description: "XAU/USD Classic 9.8 Pro Plus with 5M pattern memory, divergence, fake-breakout and market-structure analysis"
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#07090d"
};

export default function RootLayout({ children }) {
  return <html lang="th"><body><RegisterServiceWorker />{children}</body></html>;
}
