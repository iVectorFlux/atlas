import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Zawvee — AI Multimodal Learning Platform",
  description: "Next-generation personal learning environment with fluid drawing and conversational tutor intelligence.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Outfit:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased select-none font-sans bg-[#080C14] text-[#F8FAFC] overflow-hidden h-screen w-screen">
        {children}
      </body>
    </html>
  );
}
