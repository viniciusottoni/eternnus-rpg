using System.Text;
namespace Eternnus.Web;

/// <summary>
/// Termos de interesse (ADR-104): normalização de caixa/acento, stopwords, singular/plural simples, sinônimos e expressões de
/// até três palavras. Só termos do vocabulário do catálogo contam, e temas sensíveis nunca entram. Regras puras e testáveis.
/// </summary>
public static class StoreKeywords
{
    public const int MaxPhraseWords = 3;
    public const double HalfLifeDays = 30;

    static readonly string[] StopwordList =
    [
        "a","o","as","os","um","uma","uns","umas","de","do","da","dos","das","no","na","nos","nas","em","por","para","pra","pro","com","sem",
        "e","ou","mas","que","se","ao","aos","a","pelo","pela","pelos","pelas","este","esta","esse","essa","isso","isto","aquele","aquela","aquilo",
        "eu","tu","ele","ela","nos","vos","eles","elas","voce","voces","me","te","lhe","meu","minha","meus","minhas","seu","sua","seus","suas",
        "nosso","nossa","ja","nao","sim","muito","muita","muitos","muitas","mais","menos","bem","mal","tambem","so","ate","entao","quando","onde",
        "como","porque","pois","foi","ser","sao","era","sou","tem","ter","tinha","vai","vou","fazer","faz","fiz","estar","esta","estou","estava",
        "ha","hoje","ontem","amanha","aqui","ali","la","agora","depois","antes","sobre","entre","todo","toda","todos","todas","algum","alguma",
        "nenhum","nenhuma","outro","outra","outros","outras","mesmo","mesma","cada","qual","quais","quem","kkk","kkkk","haha","rs","ok","oi","ola",
        "the","and","of","to","in","for","with",
    ];
    /// <summary>Genéricos demais quando isolados (continuam válidos dentro de expressões, como "escudo do mestre").</summary>
    static readonly string[] GenericList =
    [
        "mesa","jogo","jogos","jogar","personagem","sessao","campanha","mestre","jogador","rpg","grupo","regra","sistema","coisa","dia","vez",
        "ficha","rolagem","turno","cena","historia","livro","produto",
    ];
    // As expressões são comparadas já reduzidas por Stem: as listas valem nas duas formas.
    static readonly HashSet<string> Stopwords = new(StopwordList.Concat(StopwordList.Select(Stem)), StringComparer.Ordinal);
    static readonly HashSet<string> Generic = new(GenericList.Concat(GenericList.Select(Stem)), StringComparer.Ordinal);
    /// <summary>Temas sensíveis: nunca viram interesse, mesmo que um administrador os use como tag.</summary>
    static readonly string[] Sensitive =
    [
        "religia","igreja","politic","partido","eleica","eleitor","govern","doenc","saude","depress","ansiedad","terapi","remedio","medicament",
        "gravid","aborto","sexo","sexual","gay","lesbic","transex","etnia","racism","raca","cancer","suicid","deficien","diagnost","sindicat",
    ];

    /// <summary>Forma comparável de uma palavra já dobrada: plural simples → singular aproximado.</summary>
    public static string Stem(string word)
    {
        if (word.Length <= 3) return word;
        if (word.EndsWith("oes", StringComparison.Ordinal) || word.EndsWith("aes", StringComparison.Ordinal)) return word[..^3] + "ao";
        if (word.EndsWith("ais", StringComparison.Ordinal)) return word[..^3] + "al";
        if (word.Length > 5 && word.EndsWith("eis", StringComparison.Ordinal)) return word[..^3] + "el";
        if (word.EndsWith("ns", StringComparison.Ordinal)) return word[..^2] + "m";
        if (word.EndsWith('s')) return word[..^1];
        // "flor" e "flores" chegam ambos a "flore"; "luz"/"luzes" a "luze".
        if (word.EndsWith('r') || word.EndsWith('z')) return word + "e";
        return word;
    }

    /// <summary>Palavras dobradas (sem acento, minúsculas), separadas por qualquer caractere que não seja letra ou dígito.</summary>
    public static List<string> Words(string? text)
    {
        var folded = TextSearch.Fold(text);
        var words = new List<string>();
        var sb = new StringBuilder();
        foreach (var ch in folded)
        {
            if (char.IsLetterOrDigit(ch)) { sb.Append(ch); continue; }
            if (sb.Length > 0) { words.Add(sb.ToString()); sb.Clear(); }
        }
        if (sb.Length > 0) words.Add(sb.ToString());
        return words;
    }

    /// <summary>Expressão normalizada: palavras dobradas e reduzidas, separadas por espaço.</summary>
    public static string Normalize(string? phrase) => string.Join(' ', Words(phrase).Select(Stem));

    public static bool IsSensitive(string normalized) => Sensitive.Any(s => normalized.Contains(s, StringComparison.Ordinal));

    /// <summary>Uma expressão vale como termo: não é stopword nem genérica isolada, não começa/termina em stopword, não é sensível.</summary>
    public static bool IsUsefulTerm(string normalized)
    {
        if (normalized.Length < 3 || normalized.Length > 60 || IsSensitive(normalized)) return false;
        var parts = normalized.Split(' ');
        if (parts.Length == 1) return !Stopwords.Contains(parts[0]) && !Generic.Contains(parts[0]) && !parts[0].All(char.IsDigit);
        return !Stopwords.Contains(parts[0]) && !Stopwords.Contains(parts[^1]);
    }

    /// <summary>Grupos de sinônimos (um por linha, termos separados por vírgula), já normalizados.</summary>
    public static List<string[]> SynonymGroups(string? text) =>
        (text ?? "").Split('\n')
            .Select(line => line.Split(',').Select(Normalize).Where(t => t.Length > 0).Distinct().ToArray())
            .Where(g => g.Length >= 2).Take(200).ToList();

    /// <summary>Variantes de busca (dobradas, sem reduzir): o termo, seu singular aproximado, plurais irregulares e sinônimos.</summary>
    public static List<string> SearchVariants(string term, string? synonyms, int max = 6)
    {
        var folded = TextSearch.Fold(term).Trim();
        var variants = new List<string> { folded };
        var stem = Normalize(folded);
        if (stem.Length >= 3) variants.Add(stem);
        // Plural irregular: "dragao" também encontra "dragoes" (LIKE já cobre o "s" final regular).
        foreach (var (single, plural) in new[] { ("ao", "oes"), ("al", "ais"), ("el", "eis"), ("m", "ns") })
            if (stem.EndsWith(single, StringComparison.Ordinal) && stem.Length > single.Length + 1) variants.Add(stem[..^single.Length] + plural);
        var raw = (synonyms ?? "").Split('\n').Select(line => line.Split(',').Select(t => TextSearch.Fold(t).Trim()).Where(t => t.Length > 0).ToArray());
        foreach (var group in raw)
            if (group.Any(member => Normalize(member) == stem)) variants.AddRange(group);
        return variants.Where(v => v.Length >= 2).Distinct().Take(max).ToList();
    }

    /// <summary>Expressões de 1 a 3 palavras (normalizadas) presentes no texto.</summary>
    public static IEnumerable<string> Phrases(string? text)
    {
        var words = Words(text).Select(Stem).ToList();
        for (var i = 0; i < words.Count; i++)
            for (var n = 1; n <= MaxPhraseWords && i + n <= words.Count; n++)
                yield return string.Join(' ', words.GetRange(i, n));
    }
}

/// <summary>Vocabulário do catálogo: tags, palavras-chave de categorias e sinônimos (normalizados e canônicos).</summary>
public sealed class StoreVocabulary
{
    readonly Dictionary<string, string> canonical = new(StringComparer.Ordinal);
    readonly HashSet<string> terms = new(StringComparer.Ordinal);

    public static StoreVocabulary Build(IEnumerable<string> entries, string? synonyms)
    {
        var vocabulary = new StoreVocabulary();
        foreach (var group in StoreKeywords.SynonymGroups(synonyms))
        {
            foreach (var member in group) vocabulary.canonical.TryAdd(member, group[0]);
            if (StoreKeywords.IsUsefulTerm(group[0])) vocabulary.terms.Add(group[0]);
        }
        foreach (var entry in entries)
        {
            var term = vocabulary.Canon(StoreKeywords.Normalize(entry));
            if (StoreKeywords.IsUsefulTerm(term)) vocabulary.terms.Add(term);
        }
        return vocabulary;
    }

    public int Count => terms.Count;
    public string Canon(string normalized) => canonical.TryGetValue(normalized, out var c) ? c : normalized;
    public bool Contains(string term) => terms.Contains(term);

    /// <summary>Termos do vocabulário encontrados no texto (cada um uma vez).</summary>
    public HashSet<string> TermsIn(string? text)
    {
        var found = new HashSet<string>(StringComparer.Ordinal);
        foreach (var phrase in StoreKeywords.Phrases(text))
        {
            var term = Canon(phrase);
            if (terms.Contains(term)) found.Add(term);
        }
        return found;
    }

    /// <summary>Termos de um produto: tags, palavras-chave da categoria e expressões do título (canônicos).</summary>
    public HashSet<string> ProductTerms(string title, IEnumerable<string> tags, string? categoryKeywords)
    {
        var set = new HashSet<string>(StringComparer.Ordinal);
        foreach (var tag in tags.Concat((categoryKeywords ?? "").Split(',')))
        {
            var term = Canon(StoreKeywords.Normalize(tag));
            if (term.Length > 0) set.Add(term);
        }
        foreach (var phrase in StoreKeywords.Phrases(title)) set.Add(Canon(phrase));
        return set;
    }

    /// <summary>
    /// Interesses a partir dos textos do próprio usuário: cada termo conta uma vez por texto (repetição artificial não soma),
    /// com decaimento de meia-vida de 30 dias; termo visto em um único dia vale metade. Devolve até <paramref name="max"/>
    /// termos com peso normalizado 0–1.
    /// </summary>
    public List<(string Term, double Weight)> Interests(IEnumerable<(string Text, DateTime At)> texts, DateTime now, int max = StoreModel.MaxInterests)
    {
        var sums = new Dictionary<string, double>(StringComparer.Ordinal);
        var days = new Dictionary<string, HashSet<DateOnly>>(StringComparer.Ordinal);
        foreach (var (text, at) in texts)
        {
            var age = Math.Max(0, (now - at).TotalDays);
            var decay = Math.Pow(0.5, age / StoreKeywords.HalfLifeDays);
            foreach (var term in TermsIn(text))
            {
                sums[term] = sums.GetValueOrDefault(term) + decay;
                (days.TryGetValue(term, out var set) ? set : days[term] = []).Add(DateOnly.FromDateTime(at));
            }
        }
        var scored = sums.Select(p => (Term: p.Key, Weight: Math.Log(1 + p.Value) * (days[p.Key].Count >= 2 ? 1 : 0.5)))
            .Where(p => p.Weight > 0).OrderByDescending(p => p.Weight).ThenBy(p => p.Term, StringComparer.Ordinal).Take(max).ToList();
        var top = scored.Count == 0 ? 1 : scored[0].Weight;
        return scored.Select(p => (p.Term, Math.Round(p.Weight / top, 4))).ToList();
    }
}

public sealed record StoreRankCandidate(Guid Id, string Marketplace, Guid? CategoryId, IReadOnlyList<Guid> SystemIds, IReadOnlySet<string> Terms,
    bool HasImage, bool HasDescription, bool PriceCurrent, int Priority, DateTime CreatedAt, int Clicks);

/// <param name="Primary">Sistema principal (campanha aberta, interesse escolhido ou campanha ativa mais recente).</param>
/// <param name="Secondary">Demais sistemas com peso 0–1 (recência; campanhas arquivadas pesam menos).</param>
/// <param name="Interests">Termos inferidos com consentimento (0–1).</param>
/// <param name="CategoryAffinity">Categorias dos produtos que o próprio usuário abriu (0–1).</param>
/// <param name="Seed">Semente estável da rotação (identificador do usuário).</param>
public sealed record StoreRankContext(Guid? Primary, IReadOnlyDictionary<Guid, double> Secondary, IReadOnlyDictionary<string, double> Interests,
    IReadOnlyDictionary<Guid, double> CategoryAffinity, DateTime Now, string Seed, int RotationHours, int MaxClicks);

public sealed record StoreRanked(StoreRankCandidate Candidate, int Group, double Score);

/// <summary>
/// Ranking em duas etapas (ADR-104). Primeira: grupo de relevância, em ordem imutável — 0 sistema principal, 1 sistemas
/// secundários, 2 genéricos, 3 outros sistemas com termos de interesse, 4 demais. Segunda: pontuação dentro do grupo.
/// Diversidade e rotação só reorganizam itens do mesmo grupo; popularidade, cliques e prioridade nunca mudam o grupo.
/// </summary>
public static class StoreRanking
{
    public const int GroupPrimary = 0, GroupSecondary = 1, GroupGeneric = 2, GroupInterest = 3, GroupOther = 4;

    public static class Weights
    {
        public const double Interest = 0.35, Category = 0.15, SecondarySystem = 0.15, Completeness = 0.10, OfferFreshness = 0.05,
            Priority = 0.10, Novelty = 0.05, Popularity = 0.05;
        /// <summary>Itens do mesmo grupo com pontuação a menos disto entre si formam uma faixa de rotação.</summary>
        public const double RotationBand = 0.08;
        /// <summary>Diversidade só troca a ordem por candidato com pontuação a até esta distância do melhor pendente.</summary>
        public const double DiversityMargin = 0.15;
        public const double NoveltyHalfLifeDays = 60;
    }

    public static double InterestMatch(StoreRankCandidate c, StoreRankContext x) =>
        Math.Min(1, c.Terms.Where(x.Interests.ContainsKey).Sum(t => x.Interests[t]));

    public static int Group(StoreRankCandidate c, StoreRankContext x)
    {
        if (x.Primary is { } primary && c.SystemIds.Contains(primary)) return GroupPrimary;
        if (c.SystemIds.Any(x.Secondary.ContainsKey)) return GroupSecondary;
        if (c.SystemIds.Count == 0) return GroupGeneric;
        return InterestMatch(c, x) > 0 ? GroupInterest : GroupOther;
    }

    public static double Score(StoreRankCandidate c, StoreRankContext x, int group)
    {
        var completeness = (c.HasImage ? 0.4 : 0) + (c.HasDescription ? 0.3 : 0) + (c.PriceCurrent ? 0.3 : 0);
        var secondary = group == GroupSecondary ? c.SystemIds.Select(s => x.Secondary.GetValueOrDefault(s)).DefaultIfEmpty(0).Max() : 0;
        var category = c.CategoryId is { } id ? x.CategoryAffinity.GetValueOrDefault(id) : 0;
        var age = Math.Max(0, (x.Now - c.CreatedAt).TotalDays);
        var popularity = x.MaxClicks > 0 ? Math.Log(1 + c.Clicks) / Math.Log(1 + x.MaxClicks) : 0;
        return Weights.Interest * InterestMatch(c, x)
            + Weights.Category * Math.Clamp(category, 0, 1)
            + Weights.SecondarySystem * Math.Clamp(secondary, 0, 1)
            + Weights.Completeness * completeness
            + Weights.OfferFreshness * (c.PriceCurrent ? 1 : 0)
            + Weights.Priority * Math.Clamp(c.Priority, 0, 100) / 100.0
            + Weights.Novelty * Math.Pow(0.5, age / Weights.NoveltyHalfLifeDays)
            + Weights.Popularity * popularity;
    }

    /// <summary>Lista completa ordenada: grupo, depois pontuação, com rotação limitada dentro de faixas de pontuação próxima.</summary>
    public static List<StoreRanked> Rank(IEnumerable<StoreRankCandidate> candidates, StoreRankContext x)
    {
        var bucket = (long)Math.Floor((x.Now - DateTime.UnixEpoch).TotalHours / Math.Max(1, x.RotationHours));
        var result = new List<StoreRanked>();
        foreach (var group in candidates.Select(c => { var g = Group(c, x); return new StoreRanked(c, g, Score(c, x, g)); })
                     .GroupBy(r => r.Group).OrderBy(g => g.Key))
        {
            var ordered = group.OrderByDescending(r => r.Score).ThenBy(r => r.Candidate.Id).ToList();
            for (var i = 0; i < ordered.Count;)
            {
                var j = i + 1;
                while (j < ordered.Count && ordered[i].Score - ordered[j].Score < Weights.RotationBand) j++;
                result.AddRange(ordered.GetRange(i, j - i).OrderBy(r => Hash($"{x.Seed}:{bucket}:{r.Candidate.Id}")).ThenBy(r => r.Candidate.Id));
                i = j;
            }
        }
        return result;
    }

    /// <summary>
    /// Seleção da vitrine sobre a lista ordenada: percorre os grupos em ordem e, dentro de cada um, prefere candidatos que
    /// respeitem o limite por loja e (opcionalmente) não repitam categoria, desde que a pontuação esteja perto da do melhor
    /// pendente. Nunca traz um item de grupo posterior antes de esgotar o grupo atual.
    /// </summary>
    public static List<StoreRanked> Showcase(IReadOnlyList<StoreRanked> ranked, int count, int maxPerMarketplace, bool categoryDiversity)
    {
        var chosen = new List<StoreRanked>();
        foreach (var group in ranked.GroupBy(r => r.Group).OrderBy(g => g.Key))
        {
            var pending = group.ToList();
            while (chosen.Count < count && pending.Count > 0)
            {
                var best = pending[0];
                bool Near(StoreRanked r) => best.Score - r.Score <= Weights.DiversityMargin;
                bool MarketOk(StoreRanked r) => chosen.Count(c => c.Candidate.Marketplace == r.Candidate.Marketplace) < Math.Max(1, maxPerMarketplace);
                bool CategoryOk(StoreRanked r) => !categoryDiversity || r.Candidate.CategoryId == null || chosen.All(c => c.Candidate.CategoryId != r.Candidate.CategoryId);
                var pick = pending.FirstOrDefault(r => Near(r) && MarketOk(r) && CategoryOk(r))
                    ?? pending.FirstOrDefault(r => Near(r) && MarketOk(r))
                    ?? best;
                chosen.Add(pick);
                pending.Remove(pick);
            }
            if (chosen.Count >= count) break;
        }
        return chosen;
    }

    /// <summary>FNV-1a de 64 bits: estável entre processos (string.GetHashCode é aleatório por execução).</summary>
    public static ulong Hash(string text)
    {
        var hash = 14695981039346656037UL;
        foreach (var b in Encoding.UTF8.GetBytes(text)) { hash ^= b; hash *= 1099511628211UL; }
        return hash;
    }
}
