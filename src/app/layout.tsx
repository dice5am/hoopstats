import type { Metadata } from "next";
import { AppNav } from "@/components/AppNav";
import "./fonts.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "hoopstats — Points insights",
  description:
    "NBA points: home vs away and back-to-backs, plus player points for betting and fantasy.",
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
