namespace Eternnus.Web;

/// <summary>O que o usuário já viu de um produto: exibições confirmadas, ciclo da última e se ele mesmo clicou.</summary>
public readonly record struct StoreSeen(int Exposures, long LastCycle, bool Clicked);

/// <summary>Candidato de uma fila: produto, grupo e pontuação do <see cref="StoreRanking"/> e histórico do usuário.</summary>
public sealed record StorePoolItem(StoreRankCandidate Candidate, int Group, double Score, StoreSeen? Seen)
{
    public Guid Id => Candidate.Id;
}

public sealed record StorePick(StorePoolItem Item, int Strategy);

/// <param name="Cycle">Navegação exibida atual do usuário.</param>
/// <param name="RepeatWindow">Navegações exibidas antes de o mesmo produto voltar, se houver alternativa.</param>
/// <param name="FatigueImpressions">Exibições sem clique que dobram o resfriamento (0 = desligado).</param>
public sealed record StoreRotationRules(long Cycle, int RepeatWindow, int FatigueImpressions, int MaxPerMarketplace, bool CategoryDiversity);

/// <summary>
/// Round Robin inteligente da vitrine (ADR-108), regras puras. Quatro filas — populares do perfil, novidades do perfil,
/// descoberta relacionada e exploração fora do perfil — com metas cumulativas de proporção. O 1º cartão (o único visível no
/// celular) segue um round robin ponderado suave pelo número da navegação; os demais cobrem a maior defasagem entre a meta e
/// o que o usuário de fato viu. Determinístico: sem sorteio nem semente temporal.
/// </summary>
public static class StoreRotation
{
    /// <summary>Candidatos próximos examinados para diversificar loja/categoria (sempre do mesmo grupo do melhor pendente).</summary>
    public const int DiversityLookahead = 8;
    /// <summary>Com alternativas relevantes, no máximo um cartão de exploração por exibição.</summary>
    public const int MaxExplorePerView = 1;
    /// <summary>Menor proporção de exploração aceita na configuração (nunca zero).</summary>
    public const int MinExplore = 5;
    /// <summary>Janela de novidade pela data de publicação.</summary>
    public const int NoveltyDays = 90;
    /// <summary>Aprendizado por cliques: meia-vida, ganho por produto distinto e limiar para o sistema entrar no perfil.</summary>
    public const double LearnHalfLifeDays = 30, LearnPerProduct = 0.5, LearnThreshold = 0.5, LearnedSecondaryWeight = 0.8;
    /// <summary>Faixas de "relevância semelhante" para os desempates de frescor.</summary>
    public const double PopularityBand = 0.1;
    public const int NoveltyBandDays = 7;

    /// <summary>Estratégia do 1º cartão da navegação <paramref name="cycle"/>: round robin ponderado suave (período = soma das
    /// proporções). Com 40/30/20/10: populares, novidades, descoberta, populares, novidades, exploração…</summary>
    public static int Lead(long cycle, IReadOnlyList<int> shares)
    {
        var total = shares.Sum();
        if (total <= 0) return StoreStrategies.PopularIndex;
        var steps = (int)(Math.Max(0, cycle) % total) + 1;
        var current = new long[shares.Count];
        var pick = 0;
        for (var step = 0; step < steps; step++)
        {
            for (var i = 0; i < shares.Count; i++) current[i] += shares[i];
            pick = 0;
            for (var i = 1; i < shares.Count; i++) if (current[i] > current[pick]) pick = i;
            current[pick] -= total;
        }
        return pick;
    }

    /// <summary>Estratégia planejada para cada cartão. Cartões depois do 1º cobrem a maior defasagem cumulativa
    /// (meta × total − servidas), contando o que já foi planejado; exploração no máximo uma vez.</summary>
    public static int[] Plan(long cycle, int slots, IReadOnlyList<int> shares, IReadOnlyList<long> served)
    {
        var total = Math.Max(1, shares.Sum());
        var counts = served.ToArray();
        var plan = new int[Math.Max(0, slots)];
        for (var k = 0; k < plan.Length; k++)
        {
            var s = k == 0 ? Lead(cycle, shares) : -1;
            if (s < 0)
            {
                var n = counts.Sum() + 1;
                var best = double.MinValue;
                for (var i = 0; i < shares.Count; i++)
                {
                    if (shares[i] <= 0 || (i == StoreStrategies.ExploreIndex && plan.Take(k).Contains(StoreStrategies.ExploreIndex))) continue;
                    var deficit = (double)shares[i] / total * n - counts[i];
                    if (deficit > best + 1e-9) { best = deficit; s = i; }
                }
                if (s < 0) s = plan[0];
            }
            plan[k] = s;
            counts[s]++;
        }
        return plan;
    }

    /// <summary>Ordem de redistribuição quando a fila planejada não tem candidato: ela, depois as demais por proporção.</summary>
    public static IEnumerable<int> Fallbacks(int planned, IReadOnlyList<int> shares) =>
        new[] { planned }.Concat(Enumerable.Range(0, shares.Count).Where(i => i != planned).OrderByDescending(i => shares[i]).ThenBy(i => i));

    /// <summary>Resfriamento efetivo: dobra para produtos exibidos muitas vezes sem clique do usuário (nunca é permanente).</summary>
    public static int Cooldown(StoreSeen seen, StoreRotationRules r) =>
        Math.Max(1, r.RepeatWindow) * (r.FatigueImpressions > 0 && !seen.Clicked && seen.Exposures >= r.FatigueImpressions ? 2 : 1);

    /// <summary>Pode aparecer: nunca visto ou fora do resfriamento.</summary>
    public static bool Fresh(StoreSeen? seen, StoreRotationRules r) => seen is not { } s || r.Cycle - s.LastCycle >= Cooldown(s, r);

    /// <summary>
    /// Escolhe os cartões na ordem do plano. Cada cartão tenta a fila planejada e redistribui pelas demais, só com candidatos
    /// fora do resfriamento. Depois, vagas restantes aceitam exploração além do limite (melhor que repetir) e, por fim,
    /// repetição dos vistos há mais tempo (catálogo pequeno): a vitrine não fica vazia havendo produto elegível.
    /// </summary>
    public static List<StorePick> Select(IReadOnlyList<int> plan, IReadOnlyList<IReadOnlyList<StorePoolItem>> pools, IReadOnlyList<int> shares, StoreRotationRules r)
    {
        var chosen = new List<StorePick>();
        var used = new HashSet<Guid>();
        void Take(StorePoolItem item, int strategy) { chosen.Add(new(item, strategy)); used.Add(item.Id); }
        int Explores() => chosen.Count(c => c.Strategy == StoreStrategies.ExploreIndex);

        foreach (var planned in plan)
            foreach (var s in Fallbacks(planned, shares))
            {
                if (s >= pools.Count || (s == StoreStrategies.ExploreIndex && Explores() >= MaxExplorePerView)) continue;
                if (Best(pools[s], chosen, used, r, freshOnly: true) is { } item) { Take(item, s); break; }
            }
        for (var s = 0; s < pools.Count && chosen.Count < plan.Count; s++)
            while (chosen.Count < plan.Count && Best(pools[s], chosen, used, r, freshOnly: true) is { } item) Take(item, s);
        if (chosen.Count < plan.Count)
        {
            var oldest = pools.SelectMany((pool, s) => pool.Select(i => (Item: i, Strategy: s)))
                .Where(p => !used.Contains(p.Item.Id)).DistinctBy(p => p.Item.Id)
                .OrderBy(p => p.Item.Seen?.LastCycle ?? -1).ThenBy(p => p.Item.Seen?.Exposures ?? 0)
                .ThenBy(p => p.Strategy == StoreStrategies.ExploreIndex ? 1 : 0).ThenBy(p => p.Item.Id).ToList();
            foreach (var (item, s) in oldest)
            {
                if (chosen.Count >= plan.Count) break;
                Take(item, s);
            }
        }
        return chosen;
    }

    static StorePoolItem? Best(IReadOnlyList<StorePoolItem> pool, List<StorePick> chosen, HashSet<Guid> used, StoreRotationRules r, bool freshOnly)
    {
        var open = pool.Where(i => !used.Contains(i.Id) && (!freshOnly || Fresh(i.Seen, r))).Take(DiversityLookahead).ToList();
        if (open.Count == 0) return null;
        var group = open[0].Group;
        var near = open.Where(i => i.Group == group).ToList();
        bool MarketOk(StorePoolItem i) => chosen.Count(c => c.Item.Candidate.Marketplace == i.Candidate.Marketplace) < Math.Max(1, r.MaxPerMarketplace);
        bool CategoryOk(StorePoolItem i) => !r.CategoryDiversity || i.Candidate.CategoryId == null || chosen.All(c => c.Item.Candidate.CategoryId != i.Candidate.CategoryId);
        return near.FirstOrDefault(i => MarketOk(i) && CategoryOk(i)) ?? near.FirstOrDefault(MarketOk) ?? open[0];
    }

    // ---------- Ordem de cada fila ----------
    // Desempate entre itens de relevância semelhante: nunca visto, visto há mais tempo, menos exibido; depois o sinal da fila.
    static IOrderedEnumerable<StorePoolItem> ThenFresh(IOrderedEnumerable<StorePoolItem> q) =>
        q.ThenBy(i => i.Seen is null ? 0 : 1).ThenBy(i => i.Seen?.LastCycle ?? -1).ThenBy(i => i.Seen?.Exposures ?? 0);

    /// <summary>Fila A: grupo de relevância (contexto da campanha primeiro), depois faixa de popularidade recente.</summary>
    public static List<StorePoolItem> OrderPopular(IEnumerable<StorePoolItem> items, int maxClicks) =>
        ThenFresh(items.OrderBy(i => i.Group).ThenByDescending(i => Math.Floor(StoreRanking.Popularity(i.Candidate, maxClicks) / PopularityBand)))
            .ThenByDescending(i => StoreRanking.Popularity(i.Candidate, maxClicks)).ThenByDescending(i => i.Score).ThenBy(i => i.Id).ToList();

    /// <summary>Fila B: grupo, depois semana de publicação (edição não reinicia a novidade).</summary>
    public static List<StorePoolItem> OrderNew(IEnumerable<StorePoolItem> items, DateTime now) =>
        ThenFresh(items.OrderBy(i => i.Group).ThenBy(i => Math.Floor(Math.Max(0, (now - i.Candidate.NoveltyAt).TotalDays) / NoveltyBandDays)))
            .ThenByDescending(i => i.Candidate.NoveltyAt).ThenByDescending(i => i.Score).ThenBy(i => i.Id).ToList();

    /// <summary>Fila C: com cobertura, o menos visto primeiro e categorias que o usuário menos viu; depois grupo e pontuação.</summary>
    public static List<StorePoolItem> OrderRelated(IEnumerable<StorePoolItem> items, IReadOnlyDictionary<Guid, int> categorySeen, bool coverage) => coverage
        ? items.OrderBy(i => i.Seen is null ? 0 : 1).ThenBy(i => i.Candidate.CategoryId is { } c ? categorySeen.GetValueOrDefault(c) : 0)
            .ThenBy(i => i.Group).ThenBy(i => i.Seen?.LastCycle ?? -1).ThenBy(i => i.Seen?.Exposures ?? 0).ThenByDescending(i => i.Score).ThenBy(i => i.Id).ToList()
        : ThenFresh(items.OrderBy(i => i.Group)).ThenByDescending(i => i.Score).ThenBy(i => i.Id).ToList();

    /// <summary>Fila D: com cobertura, fila circular — nunca visto, visto há mais tempo, menos exibido —, e no mesmo patamar
    /// os sistemas que o usuário começou a clicar, termos de interesse e uma ordem estável por usuário (não temporal).</summary>
    public static List<StorePoolItem> OrderExplore(IEnumerable<StorePoolItem> items, IReadOnlyDictionary<Guid, double> learned, string seed, bool coverage)
    {
        double Affinity(StorePoolItem i) => i.Candidate.SystemIds.Select(s => learned.GetValueOrDefault(s)).DefaultIfEmpty(0).Max();
        var ordered = coverage
            ? items.OrderBy(i => i.Seen is null ? 0 : 1).ThenBy(i => i.Seen?.LastCycle ?? -1).ThenBy(i => i.Seen?.Exposures ?? 0).ThenByDescending(Affinity)
            : items.OrderByDescending(Affinity).ThenBy(i => i.Seen is null ? 0 : 1).ThenBy(i => i.Seen?.LastCycle ?? -1);
        return ordered.ThenBy(i => i.Group).ThenBy(i => StoreRanking.Hash($"{seed}:{i.Id}")).ThenBy(i => i.Id).ToList();
    }

    /// <summary>
    /// Afinidade aprendida por sistema (0–1) a partir dos próprios cliques. Cada produto conta uma vez (o clique mais recente),
    /// com meia-vida de 30 dias: repetir cliques no mesmo produto não soma, e produtos distintos somam aos poucos
    /// (1 − e^(−0,5·Σ)). Um clique isolado (≈0,39) fica abaixo do limiar; dois produtos distintos recentes (≈0,63) passam.
    /// </summary>
    public static Dictionary<Guid, double> LearnSystems(IEnumerable<(Guid Product, DateTime At, IReadOnlyList<Guid> Systems)> clicks, DateTime now)
    {
        var sums = new Dictionary<Guid, double>();
        foreach (var click in clicks.GroupBy(c => c.Product).Select(g => g.MaxBy(c => c.At)))
        {
            var weight = Math.Pow(0.5, Math.Max(0, (now - click.At).TotalDays) / LearnHalfLifeDays);
            foreach (var system in click.Systems.Distinct()) sums[system] = sums.GetValueOrDefault(system) + weight;
        }
        return sums.ToDictionary(p => p.Key, p => Math.Round(1 - Math.Exp(-LearnPerProduct * p.Value), 4));
    }
}
