import { supabase } from './supabaseClient';

export type BulletinPost = {
  id: string;
  title: string;
  thumbnail_url: string | null;
  content: string;
  is_published: boolean;
  published_at: string | null;
  created_at: string;
  created_by?: string | null;
  /** 發布後顯示幾天；null＝永久保存 */
  valid_days?: number | null;
  /** 到期時間（發布時間＋天數）；null＝永久。超過就自動對一般使用者隱藏 */
  expires_at?: string | null;
};

const TABLE = 'bulletin_posts';
const COLS = 'id, title, thumbnail_url, content, is_published, published_at, created_at, created_by, valid_days, expires_at';

/** 這篇現在的狀態：草稿／顯示中／已過期（已自動隱藏）／永久 */
export function postStatus(p: BulletinPost, now = Date.now()): { key: 'draft' | 'live' | 'forever' | 'expired'; label: string; color: string } {
  if (!p.is_published) return { key: 'draft', label: '草稿', color: '#999' };
  if (!p.expires_at) return { key: 'forever', label: '永久保存', color: '#2C6E9E' };
  const left = new Date(p.expires_at).getTime() - now;
  if (left <= 0) return { key: 'expired', label: '已過期（已自動隱藏）', color: '#A32D2D' };
  const days = Math.ceil(left / 86400000);
  return { key: 'live', label: `顯示中（還剩 ${days} 天）`, color: '#3B6D11' };
}

const addDays = (iso: string, days: number) => new Date(new Date(iso).getTime() + days * 86400000).toISOString();

/** 首頁／登入後公告用：只抓「已發布而且還沒過期」的文章，最新的排最前面 */
export async function getPublishedPosts(limit = 5): Promise<BulletinPost[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select(COLS)
    .eq('is_published', true)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order('published_at', { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data as BulletinPost[];
}

/** 公佈欄管理頁用：抓全部（含草稿、已過期的） */
export async function listAllPosts(): Promise<BulletinPost[]> {
  const { data, error } = await supabase.from(TABLE).select('*').order('created_at', { ascending: false });
  if (error || !data) return [];
  return data as BulletinPost[];
}

type PostInput = { title: string; thumbnail_url: string; content: string; is_published: boolean; valid_days: number | null };

export async function createPost(input: PostInput) {
  const publishedAt = input.is_published ? new Date().toISOString() : null;
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase.from(TABLE).insert({
    title: input.title,
    thumbnail_url: input.thumbnail_url || null,
    content: input.content,
    is_published: input.is_published,
    published_at: publishedAt,
    valid_days: input.valid_days,
    expires_at: publishedAt && input.valid_days ? addDays(publishedAt, input.valid_days) : null,
    created_by: auth.user?.id ?? null,
  });
  return error?.message ?? null;
}

export async function updatePost(id: string, input: PostInput & { published_at: string | null; restart?: boolean }) {
  // 從未發布→發布時補上發布時間；已有發布時間的維持原樣（編輯內文不改排序）；選「重新發布」就從現在起算
  const publishedAt = input.is_published ? (input.restart ? new Date().toISOString() : input.published_at ?? new Date().toISOString()) : null;
  const { error } = await supabase
    .from(TABLE)
    .update({
      title: input.title,
      thumbnail_url: input.thumbnail_url || null,
      content: input.content,
      is_published: input.is_published,
      published_at: publishedAt,
      valid_days: input.valid_days,
      expires_at: publishedAt && input.valid_days ? addDays(publishedAt, input.valid_days) : null,
    })
    .eq('id', id);
  return error?.message ?? null;
}

export async function deletePost(id: string) {
  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  return error?.message ?? null;
}
