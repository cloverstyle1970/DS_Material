import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

// 배포(GitHub Pages)는 basePath /DS_Material 하위라 매니페스트 경로에도 prefix 필요.
// (Next metadata는 manifest URL에 basePath를 자동 적용하지 않음)
const BASE_PATH = process.env.NODE_ENV === "production" ? "/DS_Material" : "";

export const metadata: Metadata = {
  title: "DS 자재관리 시스템",
  description: "승강기 유지보수 스마트 자재관리 시스템",
  manifest: `${BASE_PATH}/manifest.json`,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={`${geistSans.variable} ${geistMono.variable} h-full`} suppressHydrationWarning>
      <head>
        {/* React 하이드레이션 전에 다크모드 클래스를 적용해 깜빡임 방지 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('app-theme');if(t==='dark')document.documentElement.classList.add('dark');}catch(e){}`,
          }}
        />
      </head>
      <body className="h-full bg-gray-50 antialiased">
        <Script src="https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js" strategy="lazyOnload" />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
