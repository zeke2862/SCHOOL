import './globals.css';
import LangSwitch from '@/components/LangSwitch';

export const metadata = {
  title: '學校成績系統',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant" suppressHydrationWarning>
      <head>
        {/* 頁面一載入就套用老師上次選的配色，避免閃一下預設色 */}
        <script
          dangerouslySetInnerHTML={{
            __html: "try{var t=localStorage.getItem('app_theme');if(t==='sky'||t==='mint'||t==='forest')document.documentElement.setAttribute('data-theme',t)}catch(e){}",
          }}
        />
      </head>
      <body style={{ margin: 0 }}>
        {children}
        <LangSwitch />
      </body>
    </html>
  );
}
