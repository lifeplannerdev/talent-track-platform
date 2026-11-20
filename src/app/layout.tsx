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
  title: { default: "Knowledge Validation Platform | KVP", template: "%s" },
  description: "KVP, the Knowledge Validation Platform, powered by F.L.A.G: exams and results for students and trainers.",
};

export const viewport: Viewport = {
  themeColor: "#2346a0",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sourceSans.variable} ${lexend.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        {/* Keyboard users can jump past the header; the target sits right after each header. */}
        <a
          href="#main-content"
          className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground focus-visible:not-sr-only focus-visible:fixed focus-visible:top-2 focus-visible:left-2"
        >
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
