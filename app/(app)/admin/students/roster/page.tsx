import StudentsSearchTab from '@/components/admin-tabs/StudentsSearchTab';

// 「學生名冊」已併入「查詢學生（全校／各班級）」，這個舊網址保留給舊連結，顯示同一個畫面。
export default function StudentsRosterPage() {
  return <StudentsSearchTab />;
}
