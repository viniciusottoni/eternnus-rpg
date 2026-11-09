namespace Eternnus.Web;

/// <summary>Regra de XP de um motivo: valor fixo (nulo = variável, definido pela equipe), limite diário anti-farm (nulo = sem limite) e rótulo pt-BR.</summary>
public sealed record XpRule(string Reason, int? Amount, int? DailyLimit, string Label, string Hint);

/// <summary>Contadores avaliados pelas conquistas. Cada um corresponde a um motivo de XP (quantidade de lançamentos concedidos), exceto <see cref="Level"/>.</summary>
public static class AchievementCounters
{
    public const string Characters = "characters", SessionsPlayed = "sessions_played", SessionsMastered = "sessions_mastered",
        CampaignsCreated = "campaigns_created", CampaignsJoined = "campaigns_joined", GuildTopics = "guild_topics",
        GuildPosts = "guild_posts", UsefulReceived = "useful_received", Level = "level",
        Sessions = "sessions", Roles = "roles", Paths = "paths";
}

/// <summary>Conquista: desbloqueada quando o contador alcança o limiar. Ícone é um símbolo tipográfico do guia visual.</summary>
public sealed record AchievementDefinition(string Key, string Title, string Description, string Icon, string Counter, int Threshold);

/// <summary>Recurso liberado por nível, exibido em "Próximos desbloqueios".</summary>
public sealed record LevelUnlock(int Level, string Key, string Title, string Description);

/// <summary>Posição dentro do nível atual: XP total, piso do nível, XP para o próximo (nulo no nível máximo) e porcentagem inteira (0..100).</summary>
public readonly record struct LevelProgress(int Xp, int Level, int LevelXp, int? NextLevelXp, int Percent);

/// <summary>
/// Regras puras de progressão (sem banco nem HTTP). Espelhadas em <c>wwwroot/js/progress-policy.js</c> para a interface.
/// Curva: XP total para alcançar o nível n = 50·(n−1)·n (nível 2 = 100, 3 = 300, 5 = 1.000, 10 = 4.500, 100 = 495.000).
/// Cada nível custa 100·n a mais que o anterior: os primeiros chegam em poucas sessões e os altos premiam a constância.
/// </summary>
public static class Progression
{
    public const int MaxLevel = 100;
    public const int MinSessionMinutes = 10;
    public const int BonusMin = -500, BonusMax = 500;
    public static readonly int MaxXp = XpForLevel(MaxLevel);

    /// <summary>XP total necessário para alcançar <paramref name="level"/> (1..100; fora do intervalo é limitado).</summary>
    public static int XpForLevel(int level)
    {
        var n = Math.Clamp(level, 1, MaxLevel);
        return 50 * (n - 1) * n;
    }

    /// <summary>Maior nível n (1..100) com 50·(n−1)·n ≤ xp. XP negativo equivale a zero.</summary>
    public static int LevelForXp(int xp)
    {
        if (xp <= 0) return 1;
        var n = (int)Math.Floor((1 + Math.Sqrt(1 + 0.08 * xp)) / 2);
        n = Math.Clamp(n, 1, MaxLevel);
        // Corrige eventual arredondamento do ponto flutuante nas fronteiras.
        while (n < MaxLevel && XpForLevel(n + 1) <= xp) n++;
        while (n > 1 && XpForLevel(n) > xp) n--;
        return n;
    }

    public static LevelProgress Progress(int xp)
    {
        xp = Math.Max(0, xp);
        var level = LevelForXp(xp);
        var floor = XpForLevel(level);
        if (level >= MaxLevel) return new(xp, level, floor, null, 100);
        var next = XpForLevel(level + 1);
        var percent = (int)((long)(xp - floor) * 100 / (next - floor));
        return new(xp, level, floor, next, Math.Clamp(percent, 0, 100));
    }

    /// <summary>Tabela de XP por motivo, na ordem exibida em "Como ganhar XP".</summary>
    public static readonly IReadOnlyList<XpRule> Rules =
    [
        new(XpReasons.SessionMastered, 60, 4, "Sessão conduzida como mestre", "Encerre uma sessão de pelo menos 10 minutos com ao menos um jogador elegível."),
        new(XpReasons.SessionPlayed, 50, 4, "Sessão jogada", "Entre com sua ficha ao menos 10 minutos antes do encerramento. Sair antes não retira a recompensa."),
        new(XpReasons.CampaignCreated, 20, 2, "Campanha criada", "Funde um novo mundo como mestre."),
        new(XpReasons.CampaignJoined, 15, 3, "Entrada em campanha", "Aceite um convite e junte-se a uma mesa."),
        new(XpReasons.CharacterCreated, 10, 3, "Personagem criado", "Crie uma nova ficha de aventureiro."),
        new(XpReasons.GuildTopic, 8, 3, "Tópico na Guilda", "Abra uma conversa em uma categoria da Guilda."),
        new(XpReasons.GuildUsefulReceived, 6, 5, "Resposta marcada como útil", "Outro aventureiro reconheceu sua contribuição. Desmarcar e remarcar não repete o XP."),
        new(XpReasons.GuildPost, 4, 5, "Resposta na Guilda", "Converse quando tiver algo a compartilhar. Você pode continuar respondendo após o limite de XP."),
        new(XpReasons.TicketResolved, 0, 0, "Suporte sem pontuação", "Pedir ajuda é livre de metas e não concede XP. Relate problemas sempre que precisar."),
        new(XpReasons.StaffBonus, null, null, "Bônus da equipe", "Reconhecimento manual da equipe Eternnus."),
    ];

    static readonly Dictionary<string, XpRule> ByReason = Rules.ToDictionary(r => r.Reason);

    public static XpRule? Rule(string reason) => ByReason.GetValueOrDefault(reason);
    public static bool IsKnown(string reason) => ByReason.ContainsKey(reason);
    public static string Label(string reason) => ByReason.TryGetValue(reason, out var rule) ? rule.Label : "Experiência";

    /// <summary>Recursos liberados por nível ("desbloqueios leves": jogar nunca é bloqueado).</summary>
    public static readonly IReadOnlyDictionary<string, int> FeatureLevels = new Dictionary<string, int>
    {
        [LevelFeatures.GuildTopic] = 1,
        [LevelFeatures.ExtraCampaigns] = 3,
    };

    /// <summary>Nível exigido por um recurso. Recurso desconhecido é erro de programação.</summary>
    public static int RequiredLevel(string feature) =>
        FeatureLevels.TryGetValue(feature, out var level) ? level : throw new ArgumentOutOfRangeException(nameof(feature), feature, "Recurso de nível desconhecido.");

    public static string LevelMessage(int level) => $"Disponível a partir do nível {level}. Participe de sessões e da Guilda para evoluir.";

    /// <summary>Desbloqueios fixos. A API acrescenta as categorias da Guilda com <c>MinLevelToPost</c> lido do banco.</summary>
    public static readonly IReadOnlyList<LevelUnlock> FeatureUnlocks =
    [
        new(1, LevelFeatures.GuildTopic, "Abrir tópicos na Guilda", "Inicie conversas nas categorias abertas a todos."),
    ];

    public static readonly IReadOnlyList<AchievementDefinition> Achievements =
    [
        new("sessions_3", "Histórias compartilhadas", "Participe de 3 sessões, como jogador ou mestre.", "⚑", AchievementCounters.Sessions, 3),
        new("sessions_5", "Companhia de aventuras", "Participe de 5 sessões, como jogador ou mestre.", "⚔", AchievementCounters.Sessions, 5),
        new("sessions_25", "Guardião das memórias", "Participe de 25 sessões, no seu ritmo.", "✥", AchievementCounters.Sessions, 25),
        new("sessions_50", "Uma vida de histórias", "Participe de 50 sessões, como jogador ou mestre.", "❂", AchievementCounters.Sessions, 50),
        new("both_roles", "Dos dois lados da mesa", "Jogue uma sessão e conduza outra como mestre.", "♜", AchievementCounters.Roles, 2),
        new("paths_3", "Novos horizontes", "Experimente 3 tipos de atividade que concedem XP.", "✧", AchievementCounters.Paths, 3),
        new("first_useful", "Uma mão amiga", "Receba sua primeira marcação de útil na Guilda.", "✶", AchievementCounters.UsefulReceived, 1),
        new("useful_5", "Boas referências", "Receba 5 marcações de útil na Guilda.", "❖", AchievementCounters.UsefulReceived, 5),
        new("first_character", "Forja do herói", "Crie sua primeira ficha de personagem.", "✦", AchievementCounters.Characters, 1),
        new("first_session", "Primeira jornada", "Jogue sua primeira sessão com uma ficha.", "⚔", AchievementCounters.SessionsPlayed, 1),
        new("sessions_10", "Veterano de mesa", "Jogue 10 sessões como aventureiro.", "♞", AchievementCounters.SessionsPlayed, 10),
        new("first_master", "Voz do narrador", "Conduza sua primeira sessão como mestre.", "♛", AchievementCounters.SessionsMastered, 1),
        new("master_10", "Senhor das crônicas", "Conduza 10 sessões como mestre.", "♜", AchievementCounters.SessionsMastered, 10),
        new("first_campaign", "Fundador de mundos", "Crie sua primeira campanha.", "⚜", AchievementCounters.CampaignsCreated, 1),
        new("joined_3", "Andarilho", "Entre em 3 campanhas.", "⚑", AchievementCounters.CampaignsJoined, 3),
        new("first_topic", "Arauto da Guilda", "Abra seu primeiro tópico na Guilda.", "✉", AchievementCounters.GuildTopics, 1),
        new("posts_10", "Contador de histórias", "Escreva 10 respostas na Guilda.", "❖", AchievementCounters.GuildPosts, 10),
        new("useful_10", "Conselheiro", "Receba 10 marcações de útil.", "✶", AchievementCounters.UsefulReceived, 10),
        new("useful_50", "Pilar da guilda", "Receba 50 marcações de útil.", "❂", AchievementCounters.UsefulReceived, 50),
        new("level_5", "Aventureiro experiente", "Alcance o nível 5.", "✧", AchievementCounters.Level, 5),
        new("level_10", "Lenda em formação", "Alcance o nível 10.", "✵", AchievementCounters.Level, 10),
    ];

    static readonly Dictionary<string, AchievementDefinition> AchievementsByKey = Achievements.ToDictionary(a => a.Key);
    public static AchievementDefinition? Achievement(string key) => AchievementsByKey.GetValueOrDefault(key);

    /// <summary>Progresso calculado dos lançamentos históricos, inclusive para novos marcos; bônus não contam como diversidade.</summary>
    public static Dictionary<string, int> Counters(IReadOnlyDictionary<string, int> reasons, int level)
    {
        var counters = new Dictionary<string, int> { [AchievementCounters.Level] = level };
        foreach (var (reason, count) in reasons)
            if (CounterFor(reason) is { } counter) counters[counter] = counters.GetValueOrDefault(counter) + count;
        var played = counters.GetValueOrDefault(AchievementCounters.SessionsPlayed);
        var mastered = counters.GetValueOrDefault(AchievementCounters.SessionsMastered);
        counters[AchievementCounters.Sessions] = played + mastered;
        counters[AchievementCounters.Roles] = (played > 0 ? 1 : 0) + (mastered > 0 ? 1 : 0);
        counters[AchievementCounters.Paths] = reasons.Count(r => r.Value > 0 && CounterFor(r.Key) != null);
        return counters;
    }

    /// <summary>Contador de conquistas alimentado por um motivo de XP (nulo quando o motivo não conta para conquistas).</summary>
    public static string? CounterFor(string reason) => reason switch
    {
        XpReasons.CharacterCreated => AchievementCounters.Characters,
        XpReasons.SessionPlayed => AchievementCounters.SessionsPlayed,
        XpReasons.SessionMastered => AchievementCounters.SessionsMastered,
        XpReasons.CampaignCreated => AchievementCounters.CampaignsCreated,
        XpReasons.CampaignJoined => AchievementCounters.CampaignsJoined,
        XpReasons.GuildTopic => AchievementCounters.GuildTopics,
        XpReasons.GuildPost => AchievementCounters.GuildPosts,
        XpReasons.GuildUsefulReceived => AchievementCounters.UsefulReceived,
        _ => null,
    };

    /// <summary>Menor limiar de conquista de um contador: abaixo dele não é preciso consultar nada.</summary>
    public static int? MinThreshold(string counter)
    {
        var thresholds = Achievements.Where(a => a.Counter == counter).Select(a => a.Threshold).ToList();
        return thresholds.Count == 0 ? null : thresholds.Min();
    }

    /// <summary>Conquistas de um contador cujo limiar foi alcançado.</summary>
    public static IEnumerable<AchievementDefinition> Reached(string counter, int value) =>
        Achievements.Where(a => a.Counter == counter && value >= a.Threshold);

    /// <summary>Início do "dia" dos limites diários: meia-noite UTC.</summary>
    public static DateTime DayStart(DateTime utc) => DateTime.SpecifyKind(utc.Date, DateTimeKind.Utc);

    /// <summary>Concede quando ainda não atingiu o limite diário do motivo (sem limite → sempre).</summary>
    public static bool WithinDailyLimit(string reason, int awardedToday) =>
        Rule(reason)?.DailyLimit is not { } limit || awardedToday < limit;

    /// <summary>Aplica um ajuste da equipe sem deixar o XP total abaixo de zero; devolve o valor efetivo.</summary>
    public static int EffectiveBonus(int currentXp, int amount) => Math.Max(amount, -Math.Max(0, currentXp));
}
