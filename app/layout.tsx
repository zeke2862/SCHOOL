import './globals.css';
import LangSwitch from '@/components/LangSwitch';

export const metadata = {
  title: '學校成績系統',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body style={{ background: '#F7F6F3', margin: 0 }}>
        {children}
        <LangSwitch />
      </body>
    </html>
  );
}
