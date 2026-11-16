'use client';

import { supabase } from '@/lib/supabaseClient';
import { chunk } from '@/lib/supabasePaging';

// 學生照片（sql/152）。
// - 照片放私有儲存桶 student-photos，檔名「學號.jpg」；畫面用「有時效的簽名網址」顯示
// - 上傳前在瀏覽器裁成 3:4 大頭照並壓到約 40KB 以內，學校網路與儲存空間才撐得住
// - 簽名網址有效 7 天，記在這台裝置；同一張照片 7 天內用同一個網址，瀏覽器會直接用快取不重抓

const BUCKET = 'student-photos';
export const PHOTO_W = 300;
export const PHOTO_H = 400;
const MAX_BYTES = 40 * 1024;
const URL_TTL_SEC = 7 * 24 * 3600;
const cacheKey = (no: string) => `sp_url_${no}`;
const pathOf = (studentNo: string) => `${studentNo}.jpg`;

export type PhotoMap = Record<string, string>; // 學號 → 圖片網址

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('這個檔案不是可以讀取的圖片'));
    };
    img.src = url;
  });
}

/** 置中裁成 3:4、縮到 300×400，存成 JPEG 並壓到 40KB 以內 */
export async function resizeToPhoto(file: Blob): Promise<Blob> {
  const img = await loadImage(file);
  const sw = img.naturalWidth;
  const sh = img.naturalHeight;
  if (!sw || !sh) throw new Error('圖片讀取失敗');
  // 來源比 3:4 寬就裁左右；比較高就裁上下（稍微偏上，臉通常在上半部）
  const target = PHOTO_W / PHOTO_H;
  let cw = sw;
  let ch = sh;
  let cx = 0;
  let cy = 0;
  if (sw / sh > target) {
    cw = Math.round(sh * target);
    cx = Math.round((sw - cw) / 2);
  } else {
    ch = Math.round(sw / target);
    cy = Math.round((sh - ch) * 0.3);
  }
  const canvas = document.createElement('canvas');
  canvas.width = PHOTO_W;
  canvas.height = PHOTO_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('這個瀏覽器無法處理圖片');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, PHOTO_W, PHOTO_H);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, cx, cy, cw, ch, 0, 0, PHOTO_W, PHOTO_H);
  const toBlob = (q: number) => new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', q));
  let out: Blob | null = null;
  for (const q of [0.82, 0.72, 0.62, 0.5, 0.4]) {
    out = await toBlob(q);
    if (out && out.size <= MAX_BYTES) break;
  }
  if (!out) throw new Error('圖片轉換失敗');
  return out;
}

function forget(studentNo: string) {
  try {
    localStorage.removeItem(cacheKey(studentNo));
  } catch {
    /* 略過 */
  }
}

/** 上傳（或更換）一位學生的照片；失敗會丟出中文錯誤訊息 */
export async function uploadStudentPhoto(studentNo: string, file: Blob): Promise<void> {
  const blob = await resizeToPhoto(file);
  const { error } = await supabase.storage.from(BUCKET).upload(pathOf(studentNo), blob, { upsert: true, contentType: 'image/jpeg', cacheControl: String(URL_TTL_SEC) });
  if (error) throw new Error(explain(error.message));
  const { error: e2 } = await supabase.from('student_photos').upsert({ student_no: studentNo, updated_at: new Date().toISOString() });
  if (e2) throw new Error(explain(e2.message));
  forget(studentNo);
}

export async function deleteStudentPhoto(studentNo: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).remove([pathOf(studentNo)]);
  if (error) throw new Error(explain(error.message));
  const { error: e2 } = await supabase.from('student_photos').delete().eq('student_no', studentNo);
  if (e2) throw new Error(explain(e2.message));
  forget(studentNo);
}

function explain(msg: string): string {
  if (/row-level security|policy|not authorized|Unauthorized|403/i.test(msg)) return '沒有權限（只有該班導師與教務處可以上傳或刪除照片）';
  if (/Bucket not found|does not exist|schema cache/i.test(msg)) return '照片功能尚未啟用（請管理員先執行 sql/152）';
  if (/exceeded|too large|size/i.test(msg)) return '照片檔案太大';
  return msg;
}

/**
 * 讀取一批學生的照片網址。回傳 available=false 代表 sql/152 還沒執行（畫面顯示「尚未啟用」）。
 * 一個班只會多兩次查詢：誰有照片（student_photos）＋一次取得全部簽名網址；7 天內重開不用再取。
 */
export async function loadPhotoUrls(studentNos: string[]): Promise<{ urls: PhotoMap; available: boolean }> {
  const urls: PhotoMap = {};
  const uniq = Array.from(new Set(studentNos.filter(Boolean)));
  if (uniq.length === 0) return { urls, available: true };
  const stamps: Record<string, string> = {};
  for (const part of chunk(uniq, 200)) {
    const { data, error } = await supabase.from('student_photos').select('student_no, updated_at').in('student_no', part);
    if (error) return { urls: {}, available: false };
    (data ?? []).forEach((r: any) => {
      stamps[r.student_no] = r.updated_at;
    });
  }
  const need: string[] = [];
  const nowSec = Date.now() / 1000;
  for (const no of Object.keys(stamps)) {
    try {
      const raw = localStorage.getItem(cacheKey(no));
      const c = raw ? JSON.parse(raw) : null;
      // 照片換過（時間不同）或網址快到期（剩不到一天）就重新取
      if (c && c.at === stamps[no] && c.exp - nowSec > 86400) {
        urls[no] = c.u;
        continue;
      }
    } catch {
      /* 略過 */
    }
    need.push(no);
  }
  for (const part of chunk(need, 100)) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(part.map(pathOf), URL_TTL_SEC);
    if (error || !data) continue;
    data.forEach((d: any, i: number) => {
      if (!d?.signedUrl) return;
      const no = part[i];
      urls[no] = d.signedUrl;
      try {
        localStorage.setItem(cacheKey(no), JSON.stringify({ u: d.signedUrl, at: stamps[no], exp: nowSec + URL_TTL_SEC }));
      } catch {
        /* 略過 */
      }
    });
  }
  return { urls, available: true };
}

/** 批次上傳時，用檔名找學生：先比學號，再比座號（檔名開頭的數字），最後比姓名 */
export function matchFileToStudent<T extends { student_no: string; seat_no: number | null; name: string }>(fileName: string, students: T[]): T | null {
  const stem = fileName.replace(/\.[^.]+$/, '').trim();
  const compact = stem.replace(/[\s_\-()（）.]/g, '');
  const byNo = students.find((s) => s.student_no === stem || s.student_no === compact);
  if (byNo) return byNo;
  const byNoInside = students.filter((s) => s.student_no.length >= 4 && compact.includes(s.student_no));
  if (byNoInside.length === 1) return byNoInside[0];
  const byName = students.filter((s) => s.name && stem.includes(s.name));
  if (byName.length === 1) return byName[0];
  const m = stem.match(/^\D*(\d{1,2})(?!\d)/);
  if (m) {
    const seat = Number(m[1]);
    const bySeat = students.filter((s) => s.seat_no === seat);
    if (bySeat.length === 1) return bySeat[0];
  }
  return null;
}
