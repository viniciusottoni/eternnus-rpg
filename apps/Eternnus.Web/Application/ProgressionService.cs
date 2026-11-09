using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

/// <summary>Resultado de um recálculo: XP antes/depois e nível corrigido.</summary>
public sealed record XpRecalculation(int Before, int After, int Level);

/// <summary>Motivos de XP. Valores e regras ficam em <see cref="ProgressionService"/> / Domain/Progression.</summary>
public static class XpReasons
{
    public const string SessionPlayed = "session_played";     // jogador participou de uma sessão encerrada
    public const string SessionMastered = "session_mastered"; // mestre conduziu uma sessão encerrada
    public const string CampaignCreated = "campaign_created";
    public const string CampaignJoined = "campaign_joined";
    public const string CharacterCreated = "character_created";
    public const string GuildTopic = "guild_topic";
    public const string GuildPost = "guild_post";
    public const string GuildUsefulReceived = "guild_useful";  // outro usuário marcou um post como útil
    public const string TicketResolved = "ticket_resolved";
    public const string StaffBonus = "staff_bonus";           // ajuste manual auditado pelo admin
}

/// <summary>Recursos liberados por nível ("desbloqueios leves": jogar nunca é bloqueado).</summary>
public static class LevelFeatures
{
    public const string GuildTopic = "guild_topic";
    public const string ExtraCampaigns = "extra_campaigns";
}

/// <summary>XP, níveis e conquistas. Contrato estável usado por outras funcionalidades:
/// <see cref="AwardAsync"/> é idempotente por <c>sourceKey</c> e NÃO chama SaveChanges (participa da transação de quem chama).</summary>
/// <remarks>
/// Fonte de verdade: os lançamentos <see cref="XpEntry"/>. <see cref="AppUser.Xp"/>/<see cref="AppUser.Level"/> são um resumo mantido aqui
/// e podem ser refeitos por <see cref="RecalculateAsync"/>.
/// Concorrência: duas concessões simultâneas com a mesma <c>sourceKey</c> colidem no índice único <c>IX_XpEntries_SourceKey</c> e a
/// segunda recebe <see cref="DbUpdateException"/> no SaveChanges do chamador (a operação dele falha; é aceitável porque o mesmo fato já foi registrado).
/// Duas concessões simultâneas e distintas ao MESMO usuário podem perder um incremento do resumo (sem bloqueio de linha do usuário);
/// o lançamento não se perde e o recálculo do admin corrige o total. Limites diários também são verificados sem bloqueio: em corrida,
/// um lançamento a mais no dia é possível, sem efeito relevante.
/// </remarks>
public class ProgressionService(GameDb db, AuditService audit, TimeProvider? clock = null)
{
    internal GameDb Db => db;
    internal AuditService Audit => audit;
    DateTime Now => (clock ?? TimeProvider.System).GetUtcNow().UtcDateTime;

    /// <summary>Concede XP uma única vez por <paramref name="sourceKey"/> (ex.: "guild_post:{postId}").
    /// Atualiza AppUser.Xp/Level e conquistas no mesmo contexto. O chamador faz SaveChanges.
    /// Limite diário excedido, motivo desconhecido/variável ou usuário inexistente: não concede e não lança erro.</summary>
    public virtual async Task AwardAsync(string userId, string reason, string sourceKey, CancellationToken ct = default)
    {
        var rule = Progression.Rule(reason);
        if (rule?.Amount is not { } amount || amount <= 0 || string.IsNullOrEmpty(userId) || string.IsNullOrEmpty(sourceKey)) return;
        if (sourceKey.Length > 160) throw new ArgumentException("SourceKey excede 160 caracteres.", nameof(sourceKey));
        if (await AlreadyAwardedAsync(sourceKey, ct)) return;
        if (!Progression.WithinDailyLimit(reason, await AwardedTodayAsync(userId, reason, ct))) return;
        var user = await UserAsync(userId, ct);
        if (user is null) return;
        Apply(user, reason, amount, sourceKey);
        await UnlockAsync(user, reason, ct);
    }

    /// <summary>Lança <see cref="RuleException"/> (403) se o nível do usuário não libera o recurso.</summary>
    public virtual async Task RequireLevelAsync(string userId, string feature, CancellationToken ct = default)
    {
        var required = Progression.RequiredLevel(feature);
        var level = db.Users.Local.FirstOrDefault(u => u.Id == userId)?.Level
            ?? await db.Users.AsNoTracking().Where(u => u.Id == userId).Select(u => (int?)u.Level).SingleOrDefaultAsync(ct)
            ?? 1;
        if (level < required) throw new RuleException(403, Progression.LevelMessage(required));
    }

    /// <summary>Soma os lançamentos, corrige Xp/Level, reavalia todas as conquistas e grava. Devolve o XP total.</summary>
    public async Task<int> RecalculateAsync(string userId, CancellationToken ct)
    {
        var result = await PrepareRecalculationAsync(userId, ct);
        await db.SaveChangesAsync(ct);
        return result.After;
    }

        /// <summary>Recalcula sem gravar (o endpoint de admin acrescenta a auditoria no mesmo SaveChanges).</summary>
    public async Task<XpRecalculation> PrepareRecalculationAsync(string userId, CancellationToken ct)
    {
        var user = await UserAsync(userId, ct) ?? throw new RuleException(404, "Usuário não encontrado.");
        var before = user.Xp;
        var counts = await db.XpEntries.Where(e => e.UserId == userId).GroupBy(e => e.Reason)
            .Select(g => new { Reason = g.Key, Count = g.Count(), Sum = g.Sum(e => e.Amount) }).ToListAsync(ct);
        foreach (var pending in db.XpEntries.Local.Where(e => e.UserId == userId && db.Entry(e).State == EntityState.Added))
            counts.Add(new { pending.Reason, Count = 1, Sum = pending.Amount });
        user.Xp = Math.Max(0, counts.Sum(c => c.Sum));
        user.Level = Progression.LevelForXp(user.Xp);
        var unlocked = await UnlockedKeysAsync(userId, ct);
        var counters = Progression.Counters(counts.GroupBy(c => c.Reason).ToDictionary(g => g.Key, g => g.Sum(c => c.Count)), user.Level);
        foreach (var achievement in Progression.Achievements.Where(a => counters.GetValueOrDefault(a.Counter) >= a.Threshold))
            Unlock(user.Id, achievement, unlocked);
        return new(before, user.Xp, user.Level);
    }

    /// <summary>Ajuste manual da equipe (sem limite diário). Nunca deixa o total abaixo de zero: o lançamento grava o valor efetivo.
    /// Não grava nem audita: o endpoint de admin registra a auditoria e faz SaveChanges.</summary>
    public async Task<XpEntry> PrepareBonusAsync(string userId, int amount, CancellationToken ct)
    {
        if (amount == 0 || amount < Progression.BonusMin || amount > Progression.BonusMax)
            throw new RuleException(400, $"Informe um ajuste entre {Progression.BonusMin} e {Progression.BonusMax}, diferente de zero.");
        var user = await UserAsync(userId, ct) ?? throw new RuleException(404, "Usuário não encontrado.");
        var effective = Progression.EffectiveBonus(user.Xp, amount);
        if (effective == 0) throw new RuleException(409, "Este usuário não tem XP para remover.");
        var entry = Apply(user, XpReasons.StaffBonus, effective, $"{XpReasons.StaffBonus}:{Guid.NewGuid():N}");
        if (effective > 0) await UnlockAsync(user, XpReasons.StaffBonus, ct);
        return entry;
    }

    // ---------- Internos ----------

    async Task<bool> AlreadyAwardedAsync(string sourceKey, CancellationToken ct) =>
        db.XpEntries.Local.Any(e => e.SourceKey == sourceKey && db.Entry(e).State != EntityState.Deleted)
        || await db.XpEntries.AnyAsync(e => e.SourceKey == sourceKey, ct);

    async Task<int> AwardedTodayAsync(string userId, string reason, CancellationToken ct)
    {
        if (Progression.Rule(reason)?.DailyLimit is null) return 0;
        var start = Progression.DayStart(Now);
        var saved = await db.XpEntries.CountAsync(e => e.UserId == userId && e.Reason == reason && e.CreatedAt >= start, ct);
        return saved + PendingCount(userId, reason, start);
    }

    /// <summary>Lançamentos adicionados neste contexto e ainda não gravados (não aparecem nas consultas ao banco).</summary>
    int PendingCount(string userId, string reason, DateTime? since = null) =>
        db.XpEntries.Local.Count(e => e.UserId == userId && e.Reason == reason && (since == null || e.CreatedAt >= since) && db.Entry(e).State == EntityState.Added);

    async Task<AppUser?> UserAsync(string userId, CancellationToken ct) =>
        db.Users.Local.FirstOrDefault(u => u.Id == userId) ?? await db.Users.SingleOrDefaultAsync(u => u.Id == userId, ct);

    XpEntry Apply(AppUser user, string reason, int amount, string sourceKey)
    {
        var entry = new XpEntry { UserId = user.Id, Reason = reason, Amount = amount, SourceKey = sourceKey, CreatedAt = Now };
        db.XpEntries.Add(entry);
        user.Xp = Math.Max(0, user.Xp + amount);
        user.Level = Progression.LevelForXp(user.Xp);
        return entry;
    }

    /// <summary>Avalia o catálogo com uma agregação por motivo, incluindo lançamentos pendentes e marcos compostos.</summary>
    async Task UnlockAsync(AppUser user, string reason, CancellationToken ct)
    {
        var counts = await db.XpEntries.Where(e => e.UserId == user.Id).GroupBy(e => e.Reason)
            .Select(g => new { Reason = g.Key, Count = g.Count() }).ToDictionaryAsync(g => g.Reason, g => g.Count, ct);
        foreach (var pending in db.XpEntries.Local.Where(e => e.UserId == user.Id && db.Entry(e).State == EntityState.Added))
            counts[pending.Reason] = counts.GetValueOrDefault(pending.Reason) + 1;
        var counters = Progression.Counters(counts, user.Level);
        var candidates = Progression.Achievements.Where(a => counters.GetValueOrDefault(a.Counter) >= a.Threshold).ToList();
        if (candidates.Count == 0) return;
        var keys = candidates.Select(c => c.Key).ToList();
        var unlocked = (await db.Achievements.Where(a => a.UserId == user.Id && keys.Contains(a.Key)).Select(a => a.Key).ToListAsync(ct)).ToHashSet();
        unlocked.UnionWith(db.Achievements.Local.Where(a => a.UserId == user.Id).Select(a => a.Key));
        foreach (var achievement in candidates) Unlock(user.Id, achievement, unlocked);
    }

    async Task<HashSet<string>> UnlockedKeysAsync(string userId, CancellationToken ct)
    {
        var keys = (await db.Achievements.Where(a => a.UserId == userId).Select(a => a.Key).ToListAsync(ct)).ToHashSet();
        keys.UnionWith(db.Achievements.Local.Where(a => a.UserId == userId).Select(a => a.Key));
        return keys;
    }

    void Unlock(string userId, AchievementDefinition achievement, HashSet<string> unlocked)
    {
        if (!unlocked.Add(achievement.Key)) return;
        db.Achievements.Add(new UserAchievement { UserId = userId, Key = achievement.Key, UnlockedAt = Now });
    }
}
