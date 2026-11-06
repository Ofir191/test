import type { Metadata, Viewport } from "next";
import { Heebo } from "next/font/google";
import "./globals.css";

const heebo = Heebo({
  subsets: ["hebrew", "latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "משמר · קריאות וסיורים",
  description: "מערכת לניהול קריאות ביטחון, שיבוץ סיירים ופוליגונים",
  applicationName: "משמר",
};

export const viewport: Viewport = {
  themeColor: "#07111a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body className={heebo.className}>{children}</body>
    </html>
  );
}
