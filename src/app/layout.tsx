import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import "./globals.css";

// One family; the width axis separates headings from body text.
const archivo = Archivo({ variable: "--font-archivo", subsets: ["latin"], axes: ["wdth"] });

export const metadata: Metadata = {
  title: "Sentinel Earth",
  description: "Live NASA data on fires, storms and passing asteroids, on one globe.",
};

export const viewport: Viewport = { themeColor: "#0a1128" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${archivo.variable} dark h-full antialiased`}>
      <body className="h-full">{children}</body>
    </html>
  );
}
