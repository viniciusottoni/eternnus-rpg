using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

/// <summary>
/// Limites da conta pelo plano (ADR-102): campanhas, one-shots, jogadores por mesa, fichas, armazenamento total e tamanho de arquivo.
/// O plano é sempre lido do banco; reduzir o plano nunca apaga nada, só impede novas criações acima do limite.
/// </summary>
public static class AccountLimits
{
    public static PlanLimits PlanOf(AppUser user) => AccountPlans.For(user.Plan, user.Role);

    public static async Task<PlanLimits> PlanAsync(GameDb db, string id, CancellationToken ct)
    {
        var row = await db.Users.AsNoTracking().Where(u => u.Id == id).Select(u => new { u.Plan, u.Role }).SingleOrDefaultAsync(ct)
            ?? throw new RuleException(401, "Entre novamente na sua conta.");
        return AccountPlans.For(row.Plan, row.Role);
    }

    /// <summary>Maior arquivo que a pessoa pode enviar.</summary>
    public static async Task<long> MaxFileBytesAsync(GameDb db, string id, CancellationToken ct) => (await PlanAsync(db, id, ct)).MaxFileBytes;

    public static RuleException FileTooLarge(long maxBytes) => new(413, $"O arquivo passa do limite de {AccountPlans.Size(maxBytes)} do seu plano.");

    public static async Task<AppUser> LockUserAsync(GameDb db, string id, CancellationToken ct)
    {
        var query = db.Database.IsNpgsql()
            ? db.Users.FromSqlInterpolated($"SELECT * FROM \"AspNetUsers\" WHERE \"Id\" = {id} FOR UPDATE")
            : db.Users.Where(u => u.Id == id);
        var user = await query.SingleOrDefaultAsync(ct) ?? throw new RuleException(401, "Entre novamente na sua conta.");
        // Pode haver uma entidade rastreada desde a autorização da requisição.
        await db.Entry(user).ReloadAsync(ct);
        return user;
    }
    public static Task<int> CampaignCountAsync(GameDb db, string id, CancellationToken ct) =>
        db.Campaigns.CountAsync(c => !c.IsOneShot && (c.OwnerId == id || db.Members.Any(m => m.CampaignId == c.Id && m.UserId == id)), ct);
    public static Task<int> CharacterCountAsync(GameDb db, string id, CancellationToken ct) => db.Characters.CountAsync(c => c.OwnerId == id, ct);

    /// <summary>Vaga de campanha (mestrada ou como jogador) ou participação vitalícia em one-shot. Chamar com a conta bloqueada.</summary>
    public static async Task ReserveAsync(GameDb db, AppUser user, Campaign campaign, CancellationToken ct)
    {
        var plan = PlanOf(user);
        if (!campaign.IsOneShot)
        {
            if (plan.Campaigns is { } max && await CampaignCountAsync(db, user.Id, ct) >= max)
                throw new RuleException(409, $"O plano {plan.Label} permite até {max} campanhas ativas, somando as que você mestra e participa. Saia de uma campanha antes de criar ou entrar em outra.");
            return;
        }
        if (await db.OneShotParticipations.AnyAsync(p => p.CampaignId == campaign.Id && p.UserId == user.Id, ct)) return;
        if (plan.OneShots is { } limit && user.OneShotParticipations >= limit)
            throw new RuleException(409, $"Sua conta já utilizou as {limit} participações em one-shots do plano {plan.Label}.");
        user.OneShotParticipations++;
        db.OneShotParticipations.Add(new() { UserId = user.Id, CampaignId = campaign.Id });
    }

    /// <summary>Vaga de jogador na mesa, pelo plano do mestre. Chamar com a campanha bloqueada (entradas concorrentes se serializam nela).</summary>
    public static async Task EnsurePlayerSlotAsync(GameDb db, Campaign campaign, CancellationToken ct)
    {
        var plan = await PlanAsync(db, campaign.OwnerId, ct);
        if (plan.PlayersFor(campaign.IsOneShot) is not { } max) return;
        if (await db.Members.CountAsync(m => m.CampaignId == campaign.Id, ct) >= max)
            throw new RuleException(409, $"Esta mesa já tem {max} jogadores, o máximo do plano {plan.Label} do mestre.");
    }

    /// <summary>Vaga para mais uma ficha. Bloqueia a conta: criações concorrentes não passam do limite.</summary>
    public static async Task EnsureCharacterSlotAsync(GameDb db, string id, CancellationToken ct)
    {
        var plan = PlanOf(await LockUserAsync(db, id, ct));
        if (plan.Characters is { } max && await CharacterCountAsync(db, id, ct) >= max)
            throw new RuleException(409, $"O plano {plan.Label} permite até {max} fichas de personagem. Apague uma ficha antes de criar outra.");
    }

    /// <summary>
    /// Confere o espaço total da conta antes de gravar <paramref name="added"/> bytes a mais (delta líquido; zero ou negativo sempre passa).
    /// Bloqueia a linha da conta: envios concorrentes do mesmo dono se serializam. Ordem de bloqueio: campanha → conta.
    /// </summary>
    public static async Task EnsureStorageAsync(GameDb db, string owner, long added, CancellationToken ct)
    {
        if (added <= 0) return;
        if (db.Database.IsNpgsql())
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT 1 FROM \"AspNetUsers\" WHERE \"Id\" = {owner} FOR UPDATE", ct);
        var plan = await PlanAsync(db, owner, ct);
        var used = (await StorageAsync(db, owner, ct)).Used;
        if (used + added > plan.Storage)
            throw new RuleException(409, $"O espaço do plano {plan.Label} acabou: {AccountPlans.Size(used)} de {AccountPlans.Size(plan.Storage)} usados. Apague arquivos antigos para liberar espaço.");
    }

    /// <summary>O conteúdo da campanha ocupa o espaço da conta de quem a mestra.</summary>
    public static async Task EnsureCampaignStorageAsync(GameDb db, Guid campaign, long added, CancellationToken ct)
    {
        if (added <= 0) return;
        var owner = await db.Campaigns.Where(c => c.Id == campaign).Select(c => c.OwnerId).SingleOrDefaultAsync(ct) ?? throw new RuleException(404, "Campanha não encontrada.");
        await EnsureStorageAsync(db, owner, added, ct);
    }

    /// <summary>Resumo leve para as listagens de campanhas (sem somar bytes).</summary>
    public static async Task<object> SummaryAsync(GameDb db, AppUser user, CancellationToken ct)
    {
        var plan = PlanOf(user);
        return new
        {
            plan = plan.Key,
            planLabel = plan.Label,
            unlimited = plan.Campaigns == null,
            activeCampaigns = await CampaignCountAsync(db, user.Id, ct),
            campaignLimit = plan.Campaigns,
            oneShotParticipations = user.OneShotParticipations,
            oneShotLimit = plan.OneShots,
            campaignPlayerLimit = plan.CampaignPlayers,
            oneShotPlayerLimit = plan.OneShotPlayers,
        };
    }

    /// <summary>Resumo da conta com fichas e armazenamento (somente leitura, ADR-096/102). Usado só em <c>GET /auth/limits</c>,
    /// para não somar bytes a cada listagem de campanhas.</summary>
    public static async Task<object> AccountAsync(GameDb db, AppUser user, CancellationToken ct)
    {
        var plan = PlanOf(user);
        return new
        {
            plan = plan.Key,
            planLabel = plan.Label,
            unlimited = plan.Campaigns == null,
            activeCampaigns = await CampaignCountAsync(db, user.Id, ct),
            campaignLimit = plan.Campaigns,
            oneShotParticipations = user.OneShotParticipations,
            oneShotLimit = plan.OneShots,
            characters = await CharacterCountAsync(db, user.Id, ct),
            characterLimit = plan.Characters,
            campaignPlayerLimit = plan.CampaignPlayers,
            oneShotPlayerLimit = plan.OneShotPlayers,
            maxFileBytes = plan.MaxFileBytes,
            storage = await StorageAsync(db, user.Id, ct, plan.Storage)
        };
    }

    /// <summary>
    /// Uso de armazenamento das campanhas e one-shots que a pessoa mestra, por tipo, mais os retratos das próprias fichas.
    /// <c>capacity</c> é o espaço total do plano (ADR-102), conferido por <see cref="EnsureStorageAsync"/> nos envios de arquivos e cópias de imagens.
    /// Textos contam caracteres (estimativa, sem codificação) e entram no uso, mas não bloqueiam a edição. Agregados no banco, sem carregar conteúdo.
    /// Dados estruturais de mapas e cenas (composição, tiles, camadas de névoa/paredes) entram em "Imagens e mapas"; textos da campanha,
    /// cenas, personagens do mestre, capítulos, linha do tempo, registros de sessões e o chat/log da mesa entram em "Textos" (ADR-103).
    /// </summary>
    public static async Task<StorageUsage> StorageAsync(GameDb db, string id, CancellationToken ct, long capacity = 0)
    {
        var owned = db.Campaigns.Where(c => c.OwnerId == id).Select(c => c.Id);
        var campaigns = await owned.CountAsync(ct);
        var images = await db.Set<CampaignMap>().Where(m => owned.Contains(m.CampaignId))
                .SumAsync(m => (long)m.Content.Length + (m.Composition ?? "").Length + (m.TileData ?? "").Length + m.Summary.Length + (m.Entries ?? "").Length, ct)
            + await db.Set<CampaignMapLayer>().Where(l => owned.Contains(l.CampaignId)).SumAsync(l => (long)l.State.Length + (l.Prepared ?? "").Length, ct)
            + await db.Scenes.Where(s => owned.Contains(s.CampaignId)).SumAsync(s => (long)(s.Composition ?? "").Length + (s.Layers ?? "").Length + (s.Entry ?? "").Length, ct);
        var pages = db.Set<WorkspacePage>().Where(p => p.CampaignId != null && owned.Contains(p.CampaignId.Value));
        var attachments = await db.Set<WorkspaceAttachment>().Where(a => pages.Any(p => p.Id == a.PageId)).SumAsync(a => a.Size, ct)
            + await db.Set<AtlasPublication>().Where(a => owned.Contains(a.CampaignId)).SumAsync(a => (long)a.Content.Length, ct);
        var versions = await db.Set<DocumentVersion>().Where(v => owned.Contains(v.CampaignId)).SumAsync(v => (long)v.Size, ct)
            + await db.Set<WorkspaceVersion>().Where(v => pages.Any(p => p.Id == v.PageId)).SumAsync(v => (long)v.Snapshot.Length, ct);
        var texts = await pages.SumAsync(p => (long)p.Title.Length + p.Content.Length + p.Secrets.Length, ct)
            + await db.Set<MasterResource>().Where(r => owned.Contains(r.CampaignId)).SumAsync(r => (long)r.Name.Length + r.Content.Length, ct)
            + await db.Set<CampaignLibraryEntry>().Where(e => owned.Contains(e.CampaignId)).SumAsync(e => (long)e.Title.Length + e.Text.Length, ct)
            + await db.Set<PastSession>().Where(s => owned.Contains(s.CampaignId)).SumAsync(s => (long)s.Title.Length + s.Summary.Length, ct)
            + await PastScenesAsync(db, id, ct)
            + await db.Campaigns.Where(c => c.OwnerId == id).SumAsync(c => (long)c.Name.Length + c.Description.Length + c.NextSessionNote.Length + (c.TableSettings ?? "").Length, ct)
            + await db.Scenes.Where(s => owned.Contains(s.CampaignId)).SumAsync(s => (long)s.Name.Length + s.Description.Length + s.SharedText.Length + s.PrivateNotes.Length, ct)
            + await db.MasterCharacters.Where(m => owned.Contains(m.CampaignId)).SumAsync(m => (long)m.Name.Length + m.Summary.Length + m.Notes.Length, ct)
            + await db.Set<StoryChapter>().Where(c => owned.Contains(c.CampaignId)).SumAsync(c => (long)c.Title.Length + c.Summary.Length, ct)
            + await db.Set<TimelineEvent>().Where(t => owned.Contains(t.CampaignId)).SumAsync(t => (long)t.Title.Length + t.When.Length + t.Summary.Length + t.Details.Length, ct)
            + await db.Events.Where(e => e.CampaignId != null && owned.Contains(e.CampaignId.Value)).SumAsync(e => (long)e.Content.Length + e.Data.Length, ct);
        // Retratos pertencem às fichas da pessoa (não a uma campanha), ADR-097.
        var portraits = await db.Set<CharacterPortrait>().Where(p => db.Characters.Any(c => c.Id == p.CharacterId && c.OwnerId == id)).SumAsync(p => p.Size, ct);
        return new(campaigns, capacity, images, attachments, versions, texts, portraits);
    }

    /// <summary>Cenas dos registros de sessão: coluna JSON (<c>OwnsMany…ToJson</c>), medida pelo tamanho do JSON gravado.
    /// SQL direto porque o SQLite não traduz <c>SelectMany</c> sobre JSON; o dono vai como parâmetro.</summary>
    static async Task<long> PastScenesAsync(GameDb db, string id, CancellationToken ct)
    {
        var length = db.Database.IsNpgsql() ? "length(p.\"Scenes\"::text)" : "length(p.\"Scenes\")";
        var sql = $"SELECT COALESCE(SUM({length}), 0) AS \"Value\" FROM \"PastSession\" p JOIN \"Campaigns\" c ON c.\"Id\" = p.\"CampaignId\" WHERE c.\"OwnerId\" = {{0}}";
        return await db.Database.SqlQueryRaw<long>(sql, id).SingleAsync(ct);
    }
}

/// <summary>Bytes por tipo nas campanhas mestradas e nos retratos das fichas. <see cref="Capacity"/> = espaço total do plano.</summary>
public sealed record StorageUsage(int Campaigns, long Capacity, long Images, long Attachments, long Versions, long Texts, long Portraits)
{
    public long Used => Images + Attachments + Versions + Texts + Portraits;
}
