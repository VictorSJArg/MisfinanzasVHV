import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { appProfile } from "@/lib/appProfile";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: appProfile.displayName,
  description: "Aplicación personal para administrar finanzas, alertas y agenda.",
};

import { ThemeProvider } from "@/components/ThemeProvider";
import FinancialChatbot from "@/components/FinancialChatbot";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <FinancialChatbot />
        </ThemeProvider>
      </body>
    </html>
  );
}
