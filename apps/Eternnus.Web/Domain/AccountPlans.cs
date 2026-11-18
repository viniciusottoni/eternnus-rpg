namespace Eternnus.Web;

/// <summary>
/// Planos de conta (ADR-102). Gravado em <see cref="AppUser.Plan"/>; nunca aceito do cliente, só alterado pelo admin (auditado).
/// Embaixadores e admins usam sempre o plano Max, qualquer que seja o valor gravado.
/// Limite nulo = ilimitado. Bytes em MiB/GiB, como os demais limites da plataforma.
/// </summary>
public static class AccountPlans
{
    public const string Basic = "basic", Plus = "plus", Pro = "pro", Max = "max";
    public static readonly string[] All = [Basic, Plus, Pro, Max];
    public static bool IsValid(string? plan) => plan is Basic or Plus or Pro or Max;

    const long MiB = 1024L * 1024, GiB = 1024 * MiB;
    /// <summary>Maior arquivo aceito por qualquer plano: teto das leituras de requisição. O plano de quem envia decide o limite real.</summary>
    public const long MaxFileCeiling = 100 * MiB;

    public static readonly PlanLimits BasicLimits = new(Basic, "Basic", Campaigns: 3, OneShots: 10, CampaignPlayers: 5, OneShotPlayers: 8, Characters: 5, Storage: 500 * MiB, MaxFileBytes: 20 * MiB);
    public static readonly PlanLimits PlusLimits = new(Plus, "Plus", Campaigns: 5, OneShots: 15, CampaignPlayers: 8, OneShotPlayers: 8, Characters: 10, Storage: 2 * GiB, MaxFileBytes: 30 * MiB);
    public static readonly PlanLimits ProLimits = new(Pro, "Pro", Campaigns: 10, OneShots: 30, CampaignPlayers: 15, OneShotPlayers: 15, Characters: 20, Storage: 4 * GiB, MaxFileBytes: 60 * MiB);
    public static readonly PlanLimits MaxLimits = new(Max, "Max", Campaigns: null, OneShots: null, CampaignPlayers: null, OneShotPlayers: null, Characters: null, Storage: 20 * GiB, MaxFileBytes: MaxFileCeiling);

    /// <summary>Limites efetivos: equipe (embaixador/admin) = Max; valor desconhecido ou vazio = Basic.</summary>
    public static PlanLimits For(string? plan, string? role) => PlatformRoles.IsStaff(role) ? MaxLimits : plan switch
    {
        Plus => PlusLimits,
        Pro => ProLimits,
        Max => MaxLimits,
        _ => BasicLimits,
    };

    public static string Label(string? plan) => For(plan, null).Label;

    /// <summary>"20 MB", "2 GB": texto curto para mensagens.</summary>
    public static string Size(long bytes) => bytes >= GiB && bytes % GiB == 0 ? $"{bytes / GiB} GB" : $"{Math.Ceiling(bytes / (double)MiB):0} MB";
}

/// <summary>Limites de um plano. Contadores nulos = ilimitado; armazenamento e tamanho de arquivo sempre têm teto.</summary>
public sealed record PlanLimits(string Key, string Label, int? Campaigns, int? OneShots, int? CampaignPlayers, int? OneShotPlayers, int? Characters, long Storage, long MaxFileBytes)
{
    /// <summary>Jogadores (sem contar o mestre) que uma mesa deste mestre aceita.</summary>
    public int? PlayersFor(bool oneShot) => oneShot ? OneShotPlayers : CampaignPlayers;
}
