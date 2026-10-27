import { supabase, resetIdentityCache } from '@/lib/supabaseClient';

export type DelegationRow = {
  id: string; principal_user_id: string; principal_name: string; agent_user_id: string; agent_name: string;
  start_at: string; end_at: string; reason: string | null; status: string; set_by: string | null; set_by_name: string | null;
  is_active: boolean; i_am_agent: boolean; can_revoke: boolean;
};
export type PersonRow = { id: string; name: string; role: string; rank: number; is_temporary: boolean; home_org: string | null; can_be_principal: boolean };

export async function listMyDelegations(): Promise<DelegationRow[]> {
  const { data, error } = await supabase.rpc('my_delegations');
  if (error) throw new Error(error.message);
  return (data ?? []) as DelegationRow[];
}
export async function listPeople(): Promise<PersonRow[]> {
  const { data, error } = await supabase.rpc('delegation_people');
  if (error) throw new Error(error.message);
  return (data ?? []) as PersonRow[];
}
async function notifyNow() {
  try {
    const { data } = await supabase.auth.getSession();
    const t = data.session?.access_token;
    if (t) await fetch('/api/delegation/notify', { method: 'POST', headers: { Authorization: `Bearer ${t}` } });
  } catch { /* 寄信失敗不影響設定；信件會留在佇列 */ }
}
export async function createDelegation(principal: string, agent: string, startIso: string, endIso: string, reason: string) {
  const { error } = await supabase.rpc('create_delegation', { p_principal: principal, p_agent: agent, p_start: startIso, p_end: endIso, p_reason: reason || null });
  if (error) throw new Error(error.message);
  await notifyNow();
}
export async function revokeDelegation(id: string) {
  const { error } = await supabase.rpc('revoke_delegation', { p_id: id });
  if (error) throw new Error(error.message);
  resetIdentityCache();
  window.dispatchEvent(new Event('acting-change'));
  await notifyNow();
}
export async function startActing(principalId: string) {
  const { error } = await supabase.rpc('start_acting', { p_principal: principalId });
  if (error) throw new Error(error.message);
  resetIdentityCache();
  window.dispatchEvent(new Event('acting-change'));
}
export async function stopActing() {
  const { error } = await supabase.rpc('stop_acting');
  if (error) throw new Error(error.message);
  resetIdentityCache();
  window.dispatchEvent(new Event('acting-change'));
}
