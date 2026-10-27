import { supabase } from '@/lib/supabaseClient';

// 列印課表的「模板」：標題、備註說明文字、各節上課時間。
// 存在 site_settings（setting_key = 'timetable_template'），所有列印頁共用。
// 標題與備註裡可以用 {學年度}、{學期}，列印時會自動換成目前學期。
export type TimetableTemplate = {
  schoolName: string;
  classTitle: string; // 各班課表標題
  teacherTitle: string; // 各教師課表標題
  allTeachersTitle: string; // 全校教師任課表標題
  dutyTitle: string; // 值日教師參考標題
  footerTitle: string; // 課表下方的說明標題
  note: string; // 課表下方的備註（可多行）
  weekdayTimes: string[]; // 週一～週五 第 1～3 節
  saturdayTimes: string[]; // 週六 第 1～5 節
  dismissText: string; // 該部別沒有這節（放學）時顯示的字
  freeText: string; // 教師課表沒課時顯示的字
};

export const DEFAULT_TEMPLATE: TimetableTemplate = {
  schoolName: '華雲學校',
  classTitle: '課  程  表',
  teacherTitle: '教 師 任 課 表',
  allTeachersTitle: '華雲學校 {學年度}學年度 {學期}全校教師任課表',
  dutyTitle: '每 週 教 務 室 值 日 表',
  footerTitle: '華雲學校 {學年度}學年度 {學期}課程表',
  note: '備注 19：20班導師安排作業及打掃清潔\n19：30小學部放學',
  weekdayTimes: ['下午\n5:30-6:15', '下午\n6:35-7:20', '下午\n7:25-8:10'],
  saturdayTimes: ['上午\n8:00-8:40', '上午\n8:45-9:20', '上午\n9:50-10:30', '上午\n10:35-11:15', '上午\n11:20-12:00'],
  dismissText: '放學',
  freeText: '空',
};

const KEY = 'timetable_template';

export async function loadTemplate(): Promise<TimetableTemplate> {
  const { data } = await supabase.from('site_settings').select('setting_value').eq('setting_key', KEY).maybeSingle();
  if (!data?.setting_value) return DEFAULT_TEMPLATE;
  try {
    const v = typeof data.setting_value === 'string' ? JSON.parse(data.setting_value) : data.setting_value;
    return {
      ...DEFAULT_TEMPLATE,
      ...v,
      weekdayTimes: DEFAULT_TEMPLATE.weekdayTimes.map((d, i) => v.weekdayTimes?.[i] ?? d),
      saturdayTimes: DEFAULT_TEMPLATE.saturdayTimes.map((d, i) => v.saturdayTimes?.[i] ?? d),
    };
  } catch {
    return DEFAULT_TEMPLATE;
  }
}

export async function saveTemplate(t: TimetableTemplate): Promise<string | null> {
  const { error } = await supabase
    .from('site_settings')
    .upsert({ setting_key: KEY, setting_value: JSON.stringify(t), updated_at: new Date().toISOString() }, { onConflict: 'setting_key' });
  return error ? error.message : null;
}

export function fillTemplate(text: string, year: number | string, term: string): string {
  return (text ?? '').replace(/\{學年度\}/g, String(year)).replace(/\{學期\}/g, term);
}
