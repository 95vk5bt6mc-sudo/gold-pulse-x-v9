import "./globals.css";
import RegisterServiceWorker from "./components/RegisterServiceWorker";

export const metadata = {
  title: "GOLD PULSE X v9.6.0 Active Signal",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "GOLD PULSE" },
  description: "XAU/USD dashboard with server-side GitHub Actions scans and LINE alerts"
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
