// Regras puras da tela de progresso (#progress). Espelham Domain/Progression.cs para a interface;
// o servidor continua sendo a fonte do XP, do nível e das conquistas.

export const MAX_LEVEL = 100;

/** XP total para alcançar o nível n: 50·(n−1)·n (n limitado a 1..100). */
export function xpForLevel(level) {
  const n = Math.min(MAX_LEVEL, Math.max(1, Math.trunc(Number(level) || 1)));
  return 50 * (n - 1) * n;
}

/** Maior nível n (1..100) com xpForLevel(n) ≤ xp. */
export function levelForXp(xp) {
  const value = Math.trunc(Number(xp) || 0);
  if (value <= 0) return 1;
  let n = Math.floor((1 + Math.sqrt(1 + 0.08 * value)) / 2);
  n = Math.min(MAX_LEVEL, Math.max(1, n));
  while (n < MAX_LEVEL && xpForLevel(n + 1) <= value) n++;
  while (n > 1 && xpForLevel(n) > value) n--;
  return n;
}

/** { xp, level, levelXp, nextLevelXp (null no máximo), percent (0..100), remaining } */
export function levelProgress(xp) {
  const value = Math.max(0, Math.trunc(Number(xp) || 0));
  const level = levelForXp(value);
  const levelXp = xpForLevel(level);
  if (level >= MAX_LEVEL)
    return { xp: value, level, levelXp, nextLevelXp: null, percent: 100, remaining: 0 };
  const nextLevelXp = xpForLevel(level + 1);
  const percent = Math.min(100, Math.max(0, Math.floor(((value - levelXp) * 100) / (nextLevelXp - levelXp))));
  return { xp: value, level, levelXp, nextLevelXp, percent, remaining: nextLevelXp - value };
}

const numberFormat = new Intl.NumberFormat("pt-BR");

/** "1.250 XP" */
export function formatXp(value) {
  return `${numberFormat.format(Math.trunc(Number(value) || 0))} XP`;
}

/** "+30" / "−20" (sinal de menos tipográfico) / "0". */
export function formatSigned(value) {
  const n = Math.trunc(Number(value) || 0);
  if (n > 0) return `+${numberFormat.format(n)}`;
  if (n < 0) return `−${numberFormat.format(-n)}`;
  return "0";
}

/** Valor da tabela "Como ganhar XP": fixo ou variável (bônus da equipe). */
export function amountLabel(amount) {
  if (amount === 0) return "Sem XP";
  return amount == null ? "Variável" : `+${numberFormat.format(amount)} XP`;
}

/** "10 por dia" / "Sem limite diário". */
export function dailyLimitLabel(limit) {
  if (limit === 0) return "Sem pontuação";
  if (limit == null) return "Sem limite diário";
  return `${numberFormat.format(limit)} por dia`;
}

/** Texto do uso de hoje para leitores de tela e para a tabela: "2 de 10 hoje" / "Limite de hoje atingido". */
export function todayLabel(today, limit) {
  if (limit == null || limit === 0) return "";
  const used = Math.max(0, Math.trunc(Number(today) || 0));
  return used >= limit ? "Limite de hoje atingido" : `${used} de ${limit} hoje`;
}

/** Texto da barra de XP (também usado em aria-valuetext). */
export function progressText(progress) {
  if (progress.nextLevelXp == null) return `Nível máximo alcançado · ${formatXp(progress.xp)}`;
  return `${formatXp(progress.xp - progress.levelXp)} de ${formatXp(progress.nextLevelXp - progress.levelXp)} para o nível ${progress.level + 1} (${progress.percent}%)`;
}

/** Período do ranking a partir do segmento da rota (#progress/ranking/week). */
export function rankingPeriod(segment) {
  return segment === "week" ? "week" : "all";
}

/** Ordena conquistas: desbloqueadas (mais recentes primeiro), depois bloqueadas na ordem do catálogo. */
export function sortAchievements(list) {
  return list
    .map((a, index) => ({ a, index }))
    .sort((x, y) => {
      if (x.a.unlocked !== y.a.unlocked) return x.a.unlocked ? -1 : 1;
      if (x.a.unlocked) return String(y.a.unlockedAt).localeCompare(String(x.a.unlockedAt)) || x.index - y.index;
      return x.index - y.index;
    })
    .map(({ a }) => a);
}

/** Próximos desbloqueios: ainda bloqueados, do menor nível ao maior. */
export function nextUnlocks(unlocks, limit = 4) {
  return unlocks.filter((u) => !u.unlocked).sort((a, b) => a.level - b.level).slice(0, limit);
}

/** Marcos sem prazos; destinos locais conhecidos, nunca URLs vindas da API. */
export function nextMilestones(achievements, limit = 3) {
  const destinations = {
    characters: ["#characters", "Criar personagem"],
    sessions: ["#campaigns", "Ir às campanhas"],
    sessions_played: ["#campaigns", "Ir às campanhas"],
    sessions_mastered: ["#campaigns", "Preparar uma sessão"],
    roles: ["#campaigns", "Explorar as mesas"],
    campaigns_created: ["#campaigns", "Criar campanha"],
    campaigns_joined: ["#campaigns", "Entrar com convite"],
    guild_topics: ["#guild", "Visitar a Guilda"],
    guild_posts: ["#guild", "Visitar a Guilda"],
    useful_received: ["#guild", "Compartilhar conhecimento"],
    paths: ["#overview", "Explorar caminhos"],
  };
  const seen = new Set();
  return achievements.filter(a => !a.unlocked && destinations[a.counter])
    .sort((a, b) => (b.current / b.threshold) - (a.current / a.threshold) || a.threshold - b.threshold)
    .filter(a => !seen.has(a.counter) && seen.add(a.counter))
    .slice(0, limit)
    .map(a => ({ ...a, href: destinations[a.counter][0], action: destinations[a.counter][1] }));
}

/** Data UTC do servidor no fuso do navegador: "07/11/2026" ou "07/11/2026, 22:30". Valor inválido → "". */
export function formatDay(value, withTime = false, timeZone = undefined) {
  if (!value) return "";
  const text = String(value);
  const date = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(text) ? text : text + "Z");
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("pt-BR", {
    dateStyle: "short",
    ...(withTime ? { timeStyle: "short" } : {}),
    ...(timeZone ? { timeZone } : {}),
  });
}
