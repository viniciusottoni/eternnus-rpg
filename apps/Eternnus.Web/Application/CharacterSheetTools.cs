using System.Text.Json;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

/// <summary>
/// Ferramentas da ficha (ADR-099): duplicar, pontos de restauração por sessão e visão do grupo para o mestre.
/// Leitura e escrita seguem as mesmas regras da ficha: dono para duplicar e restaurar; mestre da campanha para o grupo.
/// </summary>
public partial class CharacterSheetService
{
    /// <summary>Mesmo teto da lista de personagens: uma cópia além disso ficaria fora da lista.</summary>
    public const int MaxOwnedCharacters = 200, MaxRestorePoints = 30, MaxParty = 60;

    /// <summary>
    /// Duplica uma ficha do próprio dono: mesma versão de modelo, valores, ações, descrições, visibilidade e imagem.
    /// A cópia nasce fora das campanhas, sem histórico, condições ou atalhos da original, com o nome "… (cópia)".
    /// </summary>
    public async Task<object> CopyAsync(Guid id, string user, CancellationToken ct)
    {
        var source = await db.Characters.AsNoTracking().SingleOrDefaultAsync(c => c.Id == id && c.OwnerId == user, ct) ?? throw NotFound();
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await AccountLimits.EnsureCharacterSlotAsync(db, user, ct);
        if (await db.Characters.CountAsync(c => c.OwnerId == user, ct) >= MaxOwnedCharacters)
            throw new RuleException(409, $"Você já tem {MaxOwnedCharacters} personagens. Apague algum antes de duplicar.");
        var name = CopyName(source.Name, 100);
        var copy = new Character
        {
            OwnerId = user, Name = name, Archetype = source.Archetype, Level = source.Level, Hp = source.Hp, MaxHp = source.MaxHp,
            Strength = source.Strength, Agility = source.Agility, Intellect = source.Intellect, Constitution = source.Constitution,
            Armor = source.Armor, Movement = source.Movement, LightMeters = source.LightMeters, VisionMeters = source.VisionMeters,
            Perception = source.Perception, Senses = source.Senses, ReachMeters = source.ReachMeters, Notes = source.Notes,
            Actions = JsonSerializer.Deserialize<List<CharacterAction>>(JsonSerializer.Serialize(source.Actions)) ?? [],
            TemplateVersionId = source.TemplateVersionId, Values = source.Values, Private = source.Private, ItemNotes = source.ItemNotes,
            Revision = 1, UpdatedAt = Now,
        };
        if (source.TemplateVersionId is { } versionId)
        {
            // O nome também vive no campo com papel "nome" do modelo.
            var fields = await db.SheetTemplateVersions.AsNoTracking().Where(v => v.Id == versionId).Select(v => v.Fields).SingleOrDefaultAsync(ct) ?? [];
            if (fields.FirstOrDefault(f => f.Role == SheetFieldRoles.Name) is { } nameField)
            {
                var values = CharacterSheets.ParseValues(source.Values);
                if (values.TryGetValue(nameField.Name, out var current) && current.Length > 0)
                {
                    values[nameField.Name] = CopyName(current, Math.Min(100, CharacterSheets.TextLimit(nameField)));
                    copy.Values = JsonSerializer.Serialize(values);
                }
            }
        }
        db.Characters.Add(copy);
        if (source.PortraitVersion > 0 && await db.Set<CharacterPortrait>().AsNoTracking().SingleOrDefaultAsync(p => p.CharacterId == source.Id, ct) is { } portrait)
        {
            // A imagem copiada ocupa espaço da conta (ADR-102).
            await AccountLimits.EnsureStorageAsync(db, user, portrait.Size, ct);
            db.Set<CharacterPortrait>().Add(new CharacterPortrait
            {
                CharacterId = copy.Id, Content = portrait.Content, ContentType = portrait.ContentType, Width = portrait.Width, Height = portrait.Height,
                Size = portrait.Size, Sha256 = portrait.Sha256, UpdatedAt = Now,
            });
            copy.PortraitVersion = 1;
        }
        Snapshot(db, copy, Now);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return new { copy.Id, copy.Name };
    }

    /// <summary>"Nome (cópia)" dentro do limite, cortando o nome original quando preciso.</summary>
    public static string CopyName(string name, int max)
    {
        const string suffix = " (cópia)";
        name = name.Trim();
        return name.Length + suffix.Length <= max ? name + suffix : name[..Math.Max(0, max - suffix.Length)].TrimEnd() + suffix;
    }

    /// <summary>Sessões em que a ficha mudou (mais recentes primeiro): cada uma é um ponto "antes da sessão". Só o dono, que vê o histórico completo.</summary>
    public async Task<object> RestorePointsAsync(Guid id, string user, CancellationToken ct)
    {
        if (!await db.Characters.AnyAsync(c => c.Id == id && c.OwnerId == user, ct)) throw NotFound();
        var sessionIds = db.FieldChanges.Where(h => h.CharacterId == id && h.SessionId != null).Select(h => h.SessionId!.Value).Distinct();
        var items = await db.Sessions.AsNoTracking().Where(s => sessionIds.Contains(s.Id)).OrderByDescending(s => s.StartedAt).Take(MaxRestorePoints)
            .Select(s => new
            {
                s.Id, s.Number, s.Title, s.StartedAt,
                campaign = db.Campaigns.Where(c => c.Id == s.CampaignId).Select(c => c.Name).FirstOrDefault(),
                changes = db.FieldChanges.Count(h => h.CharacterId == id && h.SessionId == s.Id),
            }).ToListAsync(ct);
        return new { items };
    }

    /// <summary>
    /// Valores da ficha como estavam quando a sessão começou: para cada campo alterado desde então, o valor anterior
    /// à primeira mudança. Só leitura: o cliente aplica no formulário e a gravação passa pelo PUT comum (validação e histórico).
    /// Campos calculados, descrições por item, campos que não existem mais e valores cortados no histórico ficam de fora.
    /// </summary>
    public async Task<object> RestorePointAsync(Guid id, Guid sessionId, string user, CancellationToken ct)
    {
        var c = await db.Characters.AsNoTracking().SingleOrDefaultAsync(c => c.Id == id && c.OwnerId == user, ct) ?? throw NotFound();
        var session = await db.Sessions.AsNoTracking().Where(s => s.Id == sessionId && db.FieldChanges.Any(h => h.CharacterId == id && h.SessionId == s.Id))
            .Select(s => new { s.Id, s.Number, s.Title, s.StartedAt }).SingleOrDefaultAsync(ct) ?? throw new RuleException(404, "Ponto de restauração não encontrado.");
        var changes = await db.FieldChanges.AsNoTracking().Where(h => h.CharacterId == id && h.CreatedAt >= session.StartedAt && h.Field != CharacterItemNotes.HistoryField)
            .OrderBy(h => h.Id).Select(h => new { h.Field, h.OldValue }).ToListAsync(ct);
        var ctx = await CharacterSheets.LoadAsync(db, c, ct);
        var byName = ctx.Version.Fields.GroupBy(f => f.Name).ToDictionary(g => g.Key, g => g.First(), StringComparer.Ordinal);
        var values = new Dictionary<string, string>(StringComparer.Ordinal);
        var skipped = new List<string>();
        foreach (var h in changes)
        {
            if (values.ContainsKey(h.Field) || skipped.Contains(h.Field)) continue;
            if (!byName.TryGetValue(h.Field, out var f) || f.Type == SheetFieldTypes.Computed) continue;
            if (h.OldValue.Length >= CharacterSheets.HistoryValueLength) { skipped.Add(h.Field); continue; }
            values[h.Field] = h.OldValue;
        }
        // Só o que difere do valor atual.
        var current = CharacterSheets.All(ctx.Version.Fields, ctx.Stored);
        foreach (var name in values.Keys.ToList()) if (current.GetValueOrDefault(name) == values[name]) values.Remove(name);
        return new
        {
            session = new { session.Id, session.Number, session.Title, session.StartedAt },
            values,
            skipped = skipped.Select(n => byName.TryGetValue(n, out var f) && !string.IsNullOrWhiteSpace(f.Label) ? f.Label : n),
        };
    }

    /// <summary>
    /// Visão do grupo (mestre da campanha): recursos, destaques, armadura, percepção e condições de cada ficha vinculada,
    /// numa consulta por tabela. O mestre já lê todas as fichas da própria campanha (inclusive privadas).
    /// </summary>
    public async Task<object> PartyAsync(Guid campaignId, string user, CancellationToken ct)
    {
        if (!await CharacterSheets.OpenCampaigns(db).AnyAsync(c => c.Id == campaignId && c.OwnerId == user, ct)) throw new RuleException(404, "Campanha não encontrada.");
        var characters = await db.Characters.AsNoTracking()
            .Where(c => db.CampaignCharacters.Any(l => l.CampaignId == campaignId && l.CharacterId == c.Id))
            .OrderBy(c => c.Name).ThenBy(c => c.Id).Take(MaxParty).ToListAsync(ct);
        var owners = characters.Select(c => c.OwnerId).Distinct().ToList();
        var players = await db.Users.AsNoTracking().Where(u => owners.Contains(u.Id)).Select(u => new { u.Id, u.DisplayName }).ToDictionaryAsync(u => u.Id, u => u.DisplayName, ct);
        var versionIds = characters.Select(c => c.TemplateVersionId ?? SheetTemplateVersion.FreeTemplateV1Id).Distinct().ToList();
        var versions = await db.SheetTemplateVersions.AsNoTracking().Where(v => versionIds.Contains(v.Id)).ToDictionaryAsync(v => v.Id, ct);
        var items = new List<object>();
        foreach (var c in characters)
        {
            if (!versions.TryGetValue(c.TemplateVersionId ?? SheetTemplateVersion.FreeTemplateV1Id, out var v)) continue;
            var raw = c.TemplateVersionId == null ? CharacterSheets.LegacyValues(c) : CharacterSheets.ParseValues(c.Values);
            var (stored, _) = CharacterSheets.Complete(v.Fields, raw);
            var all = CharacterSheets.All(v.Fields, stored);
            var (resources, stats) = SheetSummary.Build(v.Fields, all);
            items.Add(new
            {
                c.Id, c.Name, player = players.GetValueOrDefault(c.OwnerId) ?? "Aventureiro", c.Private, c.PortraitVersion,
                resources, stats, armor = SheetSummary.Armor(v.Fields, all), perception = c.Perception,
                conditions = c.Conditions, effects = CharacterEffects.Parse(c.Effects), c.UpdatedAt,
            });
        }
        return new { items };
    }
}
