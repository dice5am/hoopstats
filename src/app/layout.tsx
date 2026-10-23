import type { Metadata } from "next";
import { AppNav } from "@/components/AppNav";
import "./fonts.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "hoopstats — Player points",
  description:
    "NBA player points: season avg, month avg, 2025-26 avg, last 5 games.",
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
