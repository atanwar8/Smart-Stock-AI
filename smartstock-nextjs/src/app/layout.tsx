import type { Metadata, Viewport } from "next";
import { Urbanist } from "next/font/google";
import "./globals.css";

// Urbanist everywhere: body text, headlines, big numbers and micro-labels. It is the face the dashboard used
// before the redesign, kept at the user's request (the redesign only changed layout and components, not the type).
// It swaps in when ready so text is never blocked on the download.
const urbanist = Urbanist({
  variable: "--font-urbanist",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
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
