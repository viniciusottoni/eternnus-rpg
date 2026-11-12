using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

/// <summary>O banco mantém o prazo e a presença do mestre; sinais em memória apenas acordam os clientes.</summary>
public sealed class OneShotLifecycleService(GameDb db, SessionSignals signals, TimeProvider clock)
{
    /// <summary>
    /// Prazo de recuperação depois da última presença do mestre (configuração <c>OneShots:RecoveryMinutes</c>, 1–120, padrão 10).
    /// Antes dele, a mesa fica em espera recuperável; depois, a limpeza remove os dados como antes.
    /// </summary>
    public static TimeSpan MasterAbsence { get; set; } = TimeSpan.FromMinutes(10);
    public const int DefaultRecoveryMinutes = 10;
    public static void Configure(int? minutes) => MasterAbsence = TimeSpan.FromMinutes(Math.Clamp(minutes ?? DefaultRecoveryMinutes, 1, 120));
    /// <summary>Até quando a mesa espera o mestre voltar (nulo fora de one-shots).</summary>
    public static DateTime? RecoverUntil(Campaign c) => c.IsOneShot && c.MasterLastSeenAt is { } seen ? seen + MasterAbsence : null;
    public static bool Expired(Campaign c, DateTime now) => c.IsOneShot &&
        (c.ExpiresAt <= now || c.MasterLastSeenAt is { } seen && seen <= now - MasterAbsence);
    public static void EnsureOpen(Campaign c, DateTime now)
    {
        if (Expired(c, now)) throw new RuleException(410, "Esta one-shot foi encerrada e seus dados estão sendo removidos.");
    }
    public async Task<int> SweepAsync(CancellationToken ct)
    {
        var now = clock.GetUtcNow().UtcDateTime;
        var absent = now - MasterAbsence;
        var ids = await db.Campaigns.AsNoTracking().Where(c => c.IsOneShot && (c.ExpiresAt <= now || c.MasterLastSeenAt <= absent))
            .OrderBy(c => c.ExpiresAt).Select(c => c.Id).Take(100).ToListAsync(ct);
        var removed = 0;
        foreach (var id in ids)
        {
            await using var tx = await db.Database.BeginTransactionAsync(ct);
            // A mesma ordem da escrita da mesa evita campanha -> sessão contra sessão -> campanha.
            var sessionQuery = db.Database.IsNpgsql()
                ? db.Sessions.FromSqlInterpolated($"SELECT * FROM \"Sessions\" WHERE \"CampaignId\" = {id} AND \"EndedAt\" IS NULL FOR UPDATE")
                : db.Sessions.Where(s => s.CampaignId == id && s.EndedAt == null);
            var session = await sessionQuery.SingleOrDefaultAsync(ct);
            var campaignQuery = db.Database.IsNpgsql()
                ? db.Campaigns.FromSqlInterpolated($"SELECT * FROM \"Campaigns\" WHERE \"Id\" = {id} FOR UPDATE")
                : db.Campaigns.Where(c => c.Id == id);
            var campaign = await campaignQuery.SingleOrDefaultAsync(ct);
            if (campaign != null)
            {
                await db.Entry(campaign).ReloadAsync(ct);
                if (Expired(campaign, now))
                {
                    await db.Set<WorkspacePage>().Where(p => p.CampaignId == campaign.Id && p.Kind != "note").ExecuteDeleteAsync(ct);
                    db.Campaigns.Remove(campaign);
                    await db.SaveChangesAsync(ct);
                    removed++;
                }
            }
            await tx.CommitAsync(ct);
            if (session != null) signals.Pulse(session.Id);
            db.ChangeTracker.Clear();
        }
        return removed;
    }
}

public sealed class OneShotWorker(IServiceScopeFactory scopes, ILogger<OneShotWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(10));
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = scopes.CreateScope();
                await scope.ServiceProvider.GetRequiredService<OneShotLifecycleService>().SweepAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex) { logger.LogError(ex, "Falha ao encerrar one-shots expiradas."); }
            if (!await timer.WaitForNextTickAsync(stoppingToken)) break;
        }
    }
}

/// <summary>Pausa sessões ativas que ficaram sem ninguém presente; o estado autoritativo continua no banco.</summary>
public sealed class EmptyTableWorker(IServiceScopeFactory scopes, ILogger<EmptyTableWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = scopes.CreateScope();
                await scope.ServiceProvider.GetRequiredService<SessionService>().PauseEmptyAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex) { logger.LogError(ex, "Falha ao pausar mesas vazias."); }
            if (!await timer.WaitForNextTickAsync(stoppingToken)) break;
        }
    }
}
