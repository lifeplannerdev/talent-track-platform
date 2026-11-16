import type { Metadata, Viewport } from "next";
import { Geist_Mono, Lexend, Source_Sans_3 } from "next/font/google";
import "./globals.css";

// Self-hosted at build time by next/font (no runtime CDN). Latin Extended covers German
// (ä ö ü ß, „ “) and the names of Kerala students alike.
const sourceSans = Source_Sans_3({
  variable: "--font-source-sans",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

const lexend = Lexend({
  variable: "--font-lexend",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "TalentTrack | Life Planner",
  description: "Exams and results for Life Planner students.",
};

export const viewport: Viewport = {
  themeColor: "#2346a0",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${sourceSans.variable} ${lexend.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
