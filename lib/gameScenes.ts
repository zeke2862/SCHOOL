// 遊戲版：每個功能頁面在遊戲世界裡的「場景」。
// RPG＝冒險據點、經營＝校園裡的小店與角落。只是頁面上方橫幅的裝飾文字，
// 功能本身的名稱（點名、成績…）完全不變，老師不會找不到東西。
// 純文字對照表，不查資料庫。

export type Scene = { icon: string; place: string; line: string };
type SceneDef = { prefixes: string[]; rpg: Scene; idle: Scene };

// 由上往下比對，先符合的先用，所以比較長、比較特定的路徑要放前面
const SCENES: SceneDef[] = [
  {
    prefixes: ['/attendance', '/reports/school-attendance', '/reports/attendance-unlock-requests', '/admin/attendance-alert-settings', '/admin/period-locks'],
    rpg: { icon: '🛡️', place: '巡邏哨站', line: '清點隊員，一個都不能少' },
    idle: { icon: '🏫', place: '晨光教室', line: '點個名，看看今天誰來了' },
  },
  {
    prefixes: ['/admin/grading', '/admin/score-submission-windows', '/reports/score-correction-requests'],
    rpg: { icon: '🔮', place: '鑑定所', line: '為每位學員鑑定實力' },
    idle: { icon: '📒', place: '成績小屋', line: '一筆一筆記下大家的成長' },
  },
  {
    prefixes: ['/admin/registrar', '/admin/students', '/reports/profile-requests', '/admin/class-accounts'],
    rpg: { icon: '📚', place: '冒險者公會', line: '入隊、轉隊、升級都在這裡登記' },
    idle: { icon: '🗂️', place: '學籍服務台', line: '把每位孩子的資料收得整整齊齊' },
  },
  {
    prefixes: ['/discipline'],
    rpg: { icon: '🏅', place: '榮譽殿堂', line: '功過分明，英雄有賞' },
    idle: { icon: '🎖️', place: '獎章櫥窗', line: '好表現值得被看見' },
  },
  {
    prefixes: ['/exam', '/admin/exam-seating'],
    rpg: { icon: '🏟️', place: '試煉場', line: '佈置考場，迎接挑戰者' },
    idle: { icon: '📝', place: '考場準備室', line: '座位排好，考試就安心' },
  },
  {
    prefixes: ['/clubs', '/admin/clubs'],
    rpg: { icon: '🎪', place: '同好營地', line: '各路好手在此集結' },
    idle: { icon: '🎨', place: '社團花棚', line: '每個興趣都開出一朵花' },
  },
  {
    prefixes: ['/rollbook'],
    rpg: { icon: '📜', place: '名冊卷軸室', line: '把隊伍名冊抄錄成卷' },
    idle: { icon: '🖨️', place: '影印小站', line: '名冊印好，帶了就走' },
  },
  {
    prefixes: ['/clock', '/staff-clock', '/admin/staff-clock'],
    rpg: { icon: '⏳', place: '城門簽到處', line: '進城出城，記得留下足跡' },
    idle: { icon: '🚪', place: '校門口', line: '早安！今天也準時抵達' },
  },
  {
    prefixes: ['/admin/scheduling', '/schedule-lookup', '/admin/school-timetable', '/admin/substitute-teaching', '/admin/teacher-desk'],
    rpg: { icon: '🗺️', place: '作戰會議室', line: '排兵佈陣，安排每一堂課' },
    idle: { icon: '📅', place: '課表工坊', line: '把一週的課排得剛剛好' },
  },
  {
    prefixes: ['/leave'],
    rpg: { icon: '⛺', place: '休息營地', line: '勇者也需要好好休息' },
    idle: { icon: '☕', place: '休息涼亭', line: '請個假，喘口氣再出發' },
  },
  {
    prefixes: ['/letters'],
    rpg: { icon: '✉️', place: '任命書工房', line: '為夥伴寫下新的任命' },
    idle: { icon: '💌', place: '聘書小舖', line: '一封封寄出對老師的邀請' },
  },
  {
    prefixes: ['/review', '/reports', '/admin/pending-changes'],
    rpg: { icon: '⚖️', place: '審議廳', line: '委託送到了，請您裁決' },
    idle: { icon: '📮', place: '服務櫃台', line: '有人在等您的回覆' },
  },
  {
    prefixes: ['/general', '/admin/general'],
    rpg: { icon: '⚒️', place: '補給站', line: '裝備、物資與修繕' },
    idle: { icon: '🧰', place: '總務倉庫', line: '校園的大小事都在這裡照顧' },
  },
  {
    prefixes: ['/notifications'],
    rpg: { icon: '📯', place: '任務佈告欄', line: '新的委託都貼在這裡' },
    idle: { icon: '🐝', place: '訊息蜂箱', line: '小蜜蜂帶來新消息' },
  },
  {
    prefixes: ['/account'],
    rpg: { icon: '🧙', place: '角色狀態', line: '整理裝備，確認身分' },
    idle: { icon: '🌿', place: '我的小屋', line: '把自己的小地方打理好' },
  },
  {
    prefixes: ['/competitions'],
    rpg: { icon: '🏆', place: '競技場', line: '榮耀屬於全力以赴的人' },
    idle: { icon: '🎏', place: '校慶廣場', line: '熱熱鬧鬧辦活動' },
  },
  {
    prefixes: ['/portal'],
    rpg: { icon: '🕊️', place: '信使驛站', line: '家長與學生的訊息往來' },
    idle: { icon: '🏡', place: '會客室', line: '家長與學生看到的畫面' },
  },
  {
    prefixes: ['/system', '/admin'],
    rpg: { icon: '🗝️', place: '賢者之塔', line: '掌管整座學園的運作' },
    idle: { icon: '🔧', place: '管理小屋', line: '把系統維護得順順的' },
  },
];

const FALLBACK: { rpg: Scene; idle: Scene } = {
  rpg: { icon: '🧭', place: '學園地圖', line: '下一站要去哪裡呢' },
  idle: { icon: '🌳', place: '校園一角', line: '慢慢逛，不用急' },
};

export function sceneFor(pathname: string, mode: 'rpg' | 'idle'): Scene {
  const hit = SCENES.find((s) => s.prefixes.some((p) => pathname === p || pathname.startsWith(p + '/') || pathname.startsWith(p + '-')));
  return (hit ?? FALLBACK)[mode];
}
