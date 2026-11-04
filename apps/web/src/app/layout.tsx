import type { Metadata } from "next";
import { Barlow_Condensed, Hanken_Grotesk } from "next/font/google";
import { Providers } from "@/components/shell/providers";
import { brand } from "@/lib/brand";
import "./globals.css";

const hanken = Hanken_Grotesk({ variable: "--font-hanken", subsets: ["latin"] });
const barlow = Barlow_Condensed({
  variable: "--font-barlow",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: { default: `${brand.appName} · ${brand.collegeName}`, template: `%s · ${brand.appName}` },
  description: `Classes, rooms and meetings for the ${brand.collegeName}.`,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${hanken.variable} ${barlow.variable} h-full antialiased`}>
      <body className="h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
