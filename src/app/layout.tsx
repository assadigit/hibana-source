import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/theme-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Hibana — Session 19 Status",
  description:
    "Hibana is a personal project & idea manager built with Hono on Cloudflare Workers + D1. This page tracks the Session 19 (v0.3.10.2) worklog: fixes, polish, and verification.",
  keywords: [
    "Hibana",
    "idea manager",
    "Hono",
    "Cloudflare Workers",
    "D1",
    "Session 19",
    "v0.3.10.2",
  ],
  authors: [{ name: "Hibana" }],
  icons: {
    icon: "/logo.svg",
  },
  openGraph: {
    title: "Hibana — Session 19 Status",
    description:
      "A safe for your ideas. Session 19 (v0.3.10.2) worklog, fixes, and live QA status.",
    siteName: "Hibana",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Hibana — Session 19 Status",
    description: "A safe for your ideas. Session 19 worklog + live QA status.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
