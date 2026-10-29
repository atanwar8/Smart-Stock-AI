import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Urbanist everywhere: body text, headlines, big numbers and micro-labels. It is the face the dashboard used
// before the redesign, kept at the user's request (the redesign only changed layout and components, not the type).
// The variable font (every weight in one 28 kB file) ships in the repo (fonts/, SIL OFL 1.1, see fonts/OFL.txt)
// instead of next/font/google: that downloads from Google at build time, and a bad response once failed the
// Docker build. It swaps in when ready so text is never blocked on the download.
const urbanist = localFont({
  src: "./fonts/Urbanist-latin-wght.woff2",
  variable: "--font-urbanist",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SmartStock AI",
  description: "Produce price forecasting and smart inventory ordering for restaurants.",
};

export const viewport: Viewport = {
  // Matches the porcelain canvas so the browser chrome blends into the page
  themeColor: "#f2f3ef",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${urbanist.variable} antialiased`}>{children}</body>
    </html>
  );
}
