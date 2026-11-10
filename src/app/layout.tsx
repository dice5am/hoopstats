import type { Metadata } from "next";
import { AppNav } from "@/components/AppNav";
import "./fonts.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "hoopstats — Points insights",
  description:
    "NBA points: home vs away and back-to-backs, plus a player points finder.",
  icons: {
    icon: [
      { url: "/hs-favicon-v2.ico", sizes: "any" },
      { url: "/hs-icon-v2.png", type: "image/png", sizes: "32x32" },
    ],
    shortcut: "/hs-favicon-v2.ico",
    apple: { url: "/hs-apple-icon-v2.png", sizes: "180x180" },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <div className="hw-wrap">
          <AppNav />
          {children}
        </div>
      </body>
    </html>
  );
}
