using System.Text.Json;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

public partial class SessionService
{
    /// <summary>Único commit de ficha, versões e eventos; sessões são bloqueadas antes da ficha.
    /// O callback valida a revisão e grava o histórico por campo, sem SaveChanges.</summary>
    public async Task<Character> WriteCharacterAsync(Guid characterId, string user,
        Func<Character, Guid?, Task<IReadOnlyList<SheetChange>>> change, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var sessionIds = await db.Sessions.Where(s => s.EndedAt == null &&
            (db.CampaignCharacters.Any(l => l.CampaignId == s.CampaignId && l.CharacterId == characterId) ||
             db.SessionParticipants.Any(p => p.SessionId == s.Id && p.CharacterId == characterId)))
            .OrderBy(s => s.Id).Select(s => s.Id).ToListAsync(ct);
        var active = new List<GameSession>();
        foreach (var id in sessionIds)
        {
            var query = db.Database.IsNpgsql()
                ? db.Sessions.FromSqlInterpolated($"SELECT * FROM \"Sessions\" WHERE \"Id\" = {id} FOR UPDATE")
                : db.Sessions.Where(s => s.Id == id);
            var s = await query.SingleOrDefaultAsync(ct);
            if (s?.EndedAt == null && s != null) active.Add(s);
        }
        var c = await db.Characters.SingleOrDefaultAsync(c => c.Id == characterId, ct)
            ?? throw new RuleException(404, "Ficha não encontrada.");
        if (c.OwnerId != user && !await CharacterSheets.IsMasterAsync(db, c.Id, user, ct))
            throw new RuleException(404, "Ficha não encontrada.");
        var primary = active.Select(s => (Guid?)s.Id).FirstOrDefault();
        var campaigns = await db.Campaigns.AsNoTracking().Where(p => active.Select(s => s.CampaignId).Contains(p.Id)).ToListAsync(ct);
        foreach (var campaign in campaigns) OneShotLifecycleService.EnsureOpen(campaign, Now);
        var changes = await change(c, primary);
        if (changes.Count > 0)
        {
            c.Revision++; c.UpdatedAt = Now;
            db.Versions.Add(new() { CharacterId = c.Id, Revision = c.Revision,
                Snapshot = JsonSerializer.Serialize(c), ChangedById = user, SessionId = primary, CreatedAt = Now });
            var author = await NameAsync(user, ct);
            var fieldChanges = db.ChangeTracker.Entries<CharacterFieldChange>().Where(e => e.State == EntityState.Added && e.Entity.CharacterId == c.Id).Select(e => e.Entity).ToList();
            foreach (var session in active.Where(s => s.Id != primary))
                foreach (var field in fieldChanges)
                    db.FieldChanges.Add(new() { CharacterId = c.Id, Field = field.Field, OldValue = field.OldValue, NewValue = field.NewValue,
                        ChangedById = user, Source = field.Source, SessionId = session.Id, TemplateVersionId = field.TemplateVersionId, CreatedAt = Now });
            foreach (var s in active)
            {
                // A mesma alteração pode afetar mais de uma mesa: cada mesa recebe sua auditoria privada.
                var summary = string.Join("; ", changes.Select(x => $"{x.Label} {ShortValue(x.Before)} → {ShortValue(x.After)}"));
                db.Events.Add(new TableEvent { CampaignId = s.CampaignId, SessionId = s.Id, UserId = user,
                    Author = author, Kind = EventKinds.Sheet, MasterOnly = true, VisibleToUserId = c.OwnerId,
                    Content = ClipSheetEvent($"{c.Name} atualizou a ficha: {summary}"),
                    Data = SheetEventData(c, changes), CreatedAt = Now });
                s.Revision++;
            }
        }
        try { await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); }
        catch (DbUpdateConcurrencyException) { throw new RuleException(409, "A ficha mudou em outra janela. Abra novamente antes de editar."); }
        foreach (var s in active) signals.Pulse(s.Id);
        return c;
    }

    static string ClipSheetEvent(string text) => text.Length <= 2000 ? text : text[..2000];
    static string ShortValue(string value) => value.Length <= 120 ? value : value[..120] + "…";
    static string SheetEventData(Character c, IReadOnlyList<SheetChange> changes)
    {
        var preview = new List<SheetChange>();
        var json = "";
        foreach (var change in changes)
        {
            preview.Add(change with { Before = ShortValue(change.Before), After = ShortValue(change.After) });
            var candidate = JsonSerializer.Serialize(new { characterId = c.Id, revision = c.Revision, changes = preview }, Json);
            if (candidate.Length > 4000) break;
            json = candidate;
        }
        return json;
    }
}
