using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

/// <param name="Scope"><c>campaign</c>, <c>home</c> ou um de <see cref="ReadScopes"/>.</param>
/// <param name="Id">Tópico (guild-topic) ou chamado (support, support-queue).</param>
/// <param name="AsOf">Instante devolvido pela leitura que mostrou as novidades; nada publicado depois é apagado.</param>
public record NoticeSeenInput(string? Scope, Guid? Id = null, Guid? CampaignId = null, string[]? Areas = null, string? Item = null, DateTime? AsOf = null);

/// <summary>Quem recebe uma novidade de campanha. O autor da ação nunca recebe.</summary>
public enum NoticeAudience { Everyone, Players, Master, Readers }

/// <summary>
/// Indicadores de novidade (ADR-069). Campanhas usam <see cref="Notice"/> por leitor, gravadas pelo caso de uso que publica.
/// Guilda, conquistas, chamados e denúncias comparam a data do conteúdo com <see cref="ReadMark"/>. Leituras não escrevem;
/// "visto" é sempre um POST explícito do próprio usuário e só apaga/avança marcas dele.
/// </summary>
public sealed partial class NoticeService(GameDb db, TimeProvider clock)
{
    DateTime Now => clock.GetUtcNow().UtcDateTime;
    const int MaxKeys = 100;

    // ---------- Gravação (chamada pelos casos de uso, dentro da transação deles) ----------

    /// <summary>Registra a novidade para o público da campanha, sem o autor. Substitui avisos anteriores do mesmo item
    /// (o público pode ter mudado). Não chama SaveChanges.</summary>
    public static async Task NotifyAsync(GameDb db, Guid campaignId, string actor, string area, string item, NoticeAudience audience, CancellationToken ct, IEnumerable<string>? readers = null)
    {
        await ForgetAsync(db, campaignId, item, ct, area);
        var owner = await db.Campaigns.Where(c => c.Id == campaignId).Select(c => c.OwnerId).SingleOrDefaultAsync(ct);
        if (owner == null) return;
        var members = await db.Members.Where(m => m.CampaignId == campaignId).Select(m => m.UserId).ToListAsync(ct);
        IEnumerable<string> recipients = audience switch
        {
            NoticeAudience.Master => [owner],
            NoticeAudience.Players => members,
            NoticeAudience.Readers => (readers ?? []).Where(r => r == owner || members.Contains(r)),
            _ => members.Append(owner),
        };
        var now = DateTime.UtcNow;
        foreach (var user in recipients.Where(u => u != actor).Distinct())
            db.Add(new Notice { UserId = user, CampaignId = campaignId, Area = area, ItemKey = item, CreatedAt = now });
    }

    /// <summary>Remove avisos de um item que deixou de existir ou de estar visível (de todos os leitores).</summary>
    public static Task ForgetAsync(GameDb db, Guid campaignId, string item, CancellationToken ct, string? area = null) =>
        db.Set<Notice>().Where(n => n.CampaignId == campaignId && n.ItemKey == item && (area == null || n.Area == area)).ExecuteDeleteAsync(ct);

    /// <summary>Avança a marca de leitura do usuário (nunca recua). Não chama SaveChanges.</summary>
    public static async Task MarkAsync(GameDb db, string user, string scope, Guid key, DateTime at, CancellationToken ct)
    {
        var mark = db.Set<ReadMark>().Local.FirstOrDefault(m => m.UserId == user && m.Scope == scope && m.Key == key)
            ?? await db.Set<ReadMark>().SingleOrDefaultAsync(m => m.UserId == user && m.Scope == scope && m.Key == key, ct);
        if (mark == null) db.Add(new ReadMark { UserId = user, Scope = scope, Key = key, SeenAt = at });
        else if (mark.SeenAt < at) mark.SeenAt = at;
    }

    // ---------- Leitura ----------

    sealed record Viewer(string Id, string Role, DateTime CreatedAt)
    {
        public bool Staff => PlatformRoles.IsStaff(Role);
        public bool Admin => Role == PlatformRoles.Admin;
    }

    /// <summary>Papel só vale com e-mail confirmado e conta sem bloqueio (como em <see cref="PlatformAccess"/>); o bloqueio é
    /// avaliado em memória para também funcionar no SQLite dos testes.</summary>
    async Task<Viewer> ViewerAsync(string user, CancellationToken ct)
    {
        var row = await db.Users.AsNoTracking().Where(u => u.Id == user).Select(u => new { u.Role, u.EmailConfirmed, u.LockoutEnd, u.CreatedAt }).SingleOrDefaultAsync(ct)
            ?? throw new RuleException(401, "Entre novamente para continuar.");
        var active = row.EmailConfirmed && (row.LockoutEnd == null || row.LockoutEnd < clock.GetUtcNow());
        return new Viewer(user, active ? row.Role : PlatformRoles.Common, row.CreatedAt);
    }

    /// <summary>Início da janela de um escopo: a marca geral do usuário, a criação da conta ou o limite de <see cref="NoticeModel.Window"/>.</summary>
    async Task<DateTime> SinceAsync(Viewer v, string scope, CancellationToken ct)
    {
        var mark = await db.Set<ReadMark>().Where(m => m.UserId == v.Id && m.Scope == scope && m.Key == Guid.Empty).Select(m => (DateTime?)m.SeenAt).SingleOrDefaultAsync(ct);
        var since = mark ?? v.CreatedAt;
        var floor = Now - NoticeModel.Window;
        return since > floor ? since : floor;
    }

    IQueryable<Campaign> MyCampaigns(string user) =>
        db.Campaigns.AsNoTracking().Where(c => c.OwnerId == user || db.Members.Any(m => m.CampaignId == c.Id && m.UserId == user));

    /// <summary>Contadores do menu e chaves dos itens novos de cada área fora das campanhas.</summary>
    public async Task<object> SummaryAsync(string user, CancellationToken ct)
    {
        var asOf = Now;
        var v = await ViewerAsync(user, ct);
        var notices = await db.Set<Notice>().AsNoTracking().Where(n => n.UserId == user && MyCampaigns(user).Any(c => c.Id == n.CampaignId))
            .GroupBy(n => new { n.CampaignId, n.Area })
            .Select(g => new { g.Key.CampaignId, g.Key.Area, count = g.Select(n => n.ItemKey).Distinct().Count() }).ToListAsync(ct);
        var ids = notices.Select(n => n.CampaignId).Distinct().ToList();
        var oneShots = (await db.Campaigns.AsNoTracking().Where(c => ids.Contains(c.Id) && c.IsOneShot).Select(c => c.Id).ToListAsync(ct)).ToHashSet();
        var byCampaign = notices.GroupBy(n => n.CampaignId).ToDictionary(g => g.Key.ToString(), g => Cap(g.Sum(n => n.count)));

        var guild = await GuildUnreadAsync(v, ct);
        var achievements = await AchievementsAsync(v, ct);
        var tickets = await TicketsAsync(v, ct);
        var queue = v.Admin ? await QueueAsync(v, ct) : [];
        var reports = v.Staff ? await ReportsAsync(v, ct) : [];
        return new
        {
            asOf,
            home = Cap(notices.Where(n => NoticeAreas.Home.Contains(n.Area)).Sum(n => n.count)),
            homeItems = notices.Where(n => NoticeAreas.Home.Contains(n.Area)).Select(n => new { campaignId = n.CampaignId, area = n.Area }),
            campaigns = Cap(notices.Where(n => !oneShots.Contains(n.CampaignId)).Sum(n => n.count)),
            oneShots = Cap(notices.Where(n => oneShots.Contains(n.CampaignId)).Sum(n => n.count)),
            byCampaign,
            guild = Cap(guild.Count + reports.Count),
            guildTopics = guild.Select(t => t.Id),
            guildCategories = guild.GroupBy(t => t.Slug).ToDictionary(g => g.Key, g => Cap(g.Count())),
            moderation = Cap(reports.Count),
            reports,
            progress = Cap(achievements.Count),
            achievements,
            support = Cap(tickets.Count),
            tickets,
            supportQueue = Cap(queue.Count),
            queue,
        };
    }

    static int Cap(int n) => Math.Min(n, NoticeModel.MaxCount + 1);

    sealed record TopicKey(Guid Id, string Slug);

    async Task<List<TopicKey>> GuildUnreadAsync(Viewer v, CancellationToken ct)
    {
        var since = await SinceAsync(v, ReadScopes.Guild, ct);
        var user = v.Id;
        return await (from t in db.GuildTopics.AsNoTracking()
                      join c in db.GuildCategories on t.CategoryId equals c.Id
                      where t.DeletedAt == null && t.HeldAt == null && c.ArchivedAt == null && t.LastPostAt > since
                          && !db.Set<ReadMark>().Any(m => m.UserId == user && m.Scope == ReadScopes.GuildTopic && m.Key == t.Id && m.SeenAt >= t.LastPostAt)
                      orderby t.LastPostAt descending
                      select new TopicKey(t.Id, c.Slug)).Take(MaxKeys).ToListAsync(ct);
    }

    async Task<List<string>> AchievementsAsync(Viewer v, CancellationToken ct)
    {
        var since = await SinceAsync(v, ReadScopes.Progress, ct);
        return await db.Achievements.AsNoTracking().Where(a => a.UserId == v.Id && a.UnlockedAt > since).OrderByDescending(a => a.UnlockedAt).Select(a => a.Key).Take(MaxKeys).ToListAsync(ct);
    }

    /// <summary>Chamados do usuário com resposta da equipe (não interna) depois da última leitura.</summary>
    async Task<List<Guid>> TicketsAsync(Viewer v, CancellationToken ct)
    {
        var since = await SinceAsync(v, ReadScopes.Support, ct);
        var user = v.Id;
        return await db.Tickets.AsNoTracking().Where(t => t.AuthorId == user && db.TicketMessages.Any(m => m.TicketId == t.Id && !m.Internal && m.AuthorId != t.AuthorId && m.CreatedAt > since
                && !db.Set<ReadMark>().Any(r => r.UserId == user && r.Scope == ReadScopes.Support && r.Key == t.Id && r.SeenAt >= m.CreatedAt)))
            .OrderByDescending(t => t.UpdatedAt).Select(t => t.Id).Take(MaxKeys).ToListAsync(ct);
    }

    /// <summary>Fila do Admin: chamados com mensagem do autor depois da última leitura daquele chamado ou da fila.</summary>
    async Task<List<Guid>> QueueAsync(Viewer v, CancellationToken ct)
    {
        var since = await SinceAsync(v, ReadScopes.SupportQueue, ct);
        var user = v.Id;
        return await db.Tickets.AsNoTracking().Where(t => db.TicketMessages.Any(m => m.TicketId == t.Id && m.AuthorId == t.AuthorId && m.CreatedAt > since
                && !db.Set<ReadMark>().Any(r => r.UserId == user && r.Scope == ReadScopes.SupportQueue && r.Key == t.Id && r.SeenAt >= m.CreatedAt)))
            .OrderByDescending(t => t.UpdatedAt).Select(t => t.Id).Take(MaxKeys).ToListAsync(ct);
    }

    async Task<List<long>> ReportsAsync(Viewer v, CancellationToken ct)
    {
        var since = await SinceAsync(v, ReadScopes.Moderation, ct);
        return await db.GuildReports.AsNoTracking().Where(r => r.ResolvedAt == null && r.CreatedAt > since && r.ReporterId != v.Id)
            .OrderByDescending(r => r.Id).Select(r => r.Id).Take(MaxKeys).ToListAsync(ct);
    }

    /// <summary>Novidades de uma campanha por área e os itens correspondentes. Exige participação.</summary>
    public async Task<object> CampaignAsync(Guid campaignId, string user, CancellationToken ct)
    {
        var asOf = Now;
        if (!await MyCampaigns(user).AnyAsync(c => c.Id == campaignId, ct)) throw new RuleException(404, "Campanha não encontrada.");
        var rows = await db.Set<Notice>().AsNoTracking().Where(n => n.UserId == user && n.CampaignId == campaignId)
            .OrderByDescending(n => n.Id).Select(n => new { n.Area, n.ItemKey }).Take(500).ToListAsync(ct);
        var distinct = rows.Distinct().ToList();
        return new
        {
            asOf,
            areas = distinct.GroupBy(r => r.Area).ToDictionary(g => g.Key, g => Cap(g.Count())),
            items = distinct.Select(r => new { area = r.Area, key = r.ItemKey }),
        };
    }

    /// <summary>Última leitura do tópico (para destacar mensagens novas). Nula = nunca aberto.</summary>
    public async Task<object> GuildTopicAsync(Guid topicId, string user, CancellationToken ct)
    {
        var v = await ViewerAsync(user, ct);
        var since = await SinceAsync(v, ReadScopes.Guild, ct);
        var mark = await db.Set<ReadMark>().AsNoTracking().Where(m => m.UserId == user && m.Scope == ReadScopes.GuildTopic && m.Key == topicId).Select(m => (DateTime?)m.SeenAt).SingleOrDefaultAsync(ct);
        return new { lastReadAt = DateTime.SpecifyKind(mark is { } m && m > since ? m : since, DateTimeKind.Utc) };
    }

    // ---------- Visto ----------

    [GeneratedRegex("^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(?:live|past|chapter)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Za-z0-9_-]{1,80})$")]
    private static partial Regex ItemPattern();

    public async Task SeenAsync(NoticeSeenInput x, string user, CancellationToken ct)
    {
        var now = Now;
        var asOf = x.AsOf is { } at ? DateTime.SpecifyKind(at.ToUniversalTime(), DateTimeKind.Utc) : now;
        if (asOf > now) asOf = now;
        var areas = x.Areas ?? [];
        if (areas.Length > NoticeAreas.All.Length || areas.Any(a => !NoticeAreas.All.Contains(a))) throw new RuleException(400, "Área de novidades desconhecida.");
        if (x.Item is { } item && (item.Length > 80 || !ItemPattern().IsMatch(item))) throw new RuleException(400, "Item inválido.");
        var notices = db.Set<Notice>().Where(n => n.UserId == user && n.CreatedAt <= asOf);
        switch (x.Scope)
        {
            case "campaign":
                if (x.CampaignId is not { } campaign) throw new RuleException(400, "Informe a campanha.");
                notices = notices.Where(n => n.CampaignId == campaign);
                if (areas.Length > 0) notices = notices.Where(n => areas.Contains(n.Area));
                if (x.Item != null) notices = notices.Where(n => n.ItemKey == x.Item);
                await notices.ExecuteDeleteAsync(ct);
                return;
            case "home":
                await notices.Where(n => NoticeAreas.Home.Contains(n.Area)).ExecuteDeleteAsync(ct);
                return;
        }
        var scope = x.Scope ?? "";
        if (!ReadScopes.All.Contains(scope)) throw new RuleException(400, "Escopo de novidades desconhecido.");
        var key = x.Id ?? Guid.Empty;
        switch (scope)
        {
            case ReadScopes.GuildTopic:
                if (key == Guid.Empty || !await db.GuildTopics.AnyAsync(t => t.Id == key, ct)) throw new RuleException(404, "Tópico não encontrado.");
                break;
            case ReadScopes.Guild or ReadScopes.Progress or ReadScopes.Moderation:
                if (key != Guid.Empty) throw new RuleException(400, "Este escopo não aceita item.");
                if (scope == ReadScopes.Moderation && !(await ViewerAsync(user, ct)).Staff) throw new RuleException(403, "Acesso restrito à equipe.");
                break;
            case ReadScopes.Support:
                if (key != Guid.Empty && !await db.Tickets.AnyAsync(t => t.Id == key && t.AuthorId == user, ct)) throw new RuleException(404, "Chamado não encontrado.");
                break;
            case ReadScopes.SupportQueue:
                if (!(await ViewerAsync(user, ct)).Admin) throw new RuleException(403, "Acesso restrito à administração.");
                if (key != Guid.Empty && !await db.Tickets.AnyAsync(t => t.Id == key, ct)) throw new RuleException(404, "Chamado não encontrado.");
                break;
        }
        await MarkAsync(db, user, scope, key, asOf, ct);
        try { await db.SaveChangesAsync(ct); }
        // Outra aba gravou a mesma marca ao mesmo tempo: a dela vale (também avança).
        catch (DbUpdateException) { }
    }
}
