import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  title: "Guest Inbox",
  description: "Guest conversations, reservations and tasks in one place",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full overflow-x-hidden antialiased print:overflow-visible`}
    >
      {/* No sideways page scroll: its scrollbar showed as a white strip under the app. */}
      <body className="min-h-full flex flex-col overflow-x-hidden print:overflow-visible" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
