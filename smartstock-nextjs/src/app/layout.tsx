import type { Metadata, Viewport } from "next";
import { Geist_Mono, Instrument_Serif, Inter } from "next/font/google";
import "./globals.css";

// Apple devices render the UI in SF (system stack in globals.css); Inter is the fallback everywhere else.
// Every face swaps in when ready so text is never blocked on a font download.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

// Serif for headlines and big numbers
const instrument = Instrument_Serif({
  variable: "--font-instrument",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
});

// Mono for micro-labels and small numerics
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
      <body className={`${inter.variable} ${instrument.variable} ${geistMono.variable} antialiased`}>{children}</body>
    </html>
  );
}
