import type { Profile } from './gameData';

// RPG 寶箱：完成當天所有任務後可以開一次，開出「寵物飼料」。
// （原本開出的是星星，但星星在 RPG 模式沒有任何用途；飼料才是餵寵物、讓牠進化的材料。）
// 一天正常完成的任務約可換 100 多飼料，寶箱 30 約等於再多一份「全勤獎勵」。
export const CHEST_FOOD = 30;
export const CHEST_KEY = 'chest';

export function chestOpened(p: Profile): boolean {
  return p.claimed.includes(CHEST_KEY);
}

/** 開寶箱：加上飼料並記錄今天開過了。已經開過就原封不動回傳（不會重複領） */
export function openChest(p: Profile): Profile {
  if (chestOpened(p)) return p;
  return {
    ...p,
    claimed: [...p.claimed, CHEST_KEY],
    extras: { ...p.extras, food: p.extras.food + CHEST_FOOD },
  };
}
