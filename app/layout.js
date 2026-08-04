import "./globals.css";
import RegisterServiceWorker from "./components/RegisterServiceWorker";

export const metadata = {
  title: "GOLD PULSE X v10.3.1 Adaptive Quality",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "GOLD PULSE" },
  description: "XAU/USD Classic 9.8 Pro Plus dashboard with cron-job.org scans and quality-first LINE alerts"
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
