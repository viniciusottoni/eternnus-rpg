using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

public record RpgSystemInput(string Name, string? Slug, string? Description);
public record RpgSystemUpdate(string Name, string Slug, string? Description, bool Active, int Revision);
public record RpgSystemTableSettingsInput(TableSettings? Settings, int Revision);

/// <summary>Sistemas de RPG: listagem pública (somente ativos) e CRUD administrativo auditado.
/// O "Sistema livre" (<see cref="RpgSystem.FreeSystemId"/>) nunca é excluído nem desativado.</summary>
public partial class RpgSystemService(GameDb db, AuditService audit)
{
    internal GameDb Db => db;
    internal AuditService Audit => audit;

    [GeneratedRegex("^[a-z0-9]+(-[a-z0-9]+)*$")] private static partial Regex SlugPattern();
    public static bool IsValidSlug(string? slug) => slug is { Length: > 0 and <= 60 } && SlugPattern().IsMatch(slug);

    /// <summary>Gera um slug a partir do nome: minúsculas, sem acentos, somente a-z, 0-9 e hífens simples.</summary>
    public static string Slugify(string? name)
    {
        var builder = new StringBuilder();
        foreach (var ch in (name ?? "").Normalize(NormalizationForm.FormD))
        {
            if (CharUnicodeInfo.GetUnicodeCategory(ch) == UnicodeCategory.NonSpacingMark) continue;
            var c = char.ToLowerInvariant(ch);
            if (c is >= 'a' and <= 'z' or >= '0' and <= '9') builder.Append(c);
            else if (builder.Length > 0 && builder[^1] != '-') builder.Append('-');
        }
        var slug = builder.ToString().Trim('-');
        if (slug.Length > 60) slug = slug[..60].Trim('-');
        return slug;
    }

    static string CleanName(string? name)
    {
        var value = (name ?? "").Trim();
        if (value.Length is < 2 or > 80) throw new RuleException(400, "O nome do sistema deve ter entre 2 e 80 caracteres.");
        return value;
    }
    static string CleanDescription(string? description)
    {
        var value = (description ?? "").Trim();
        if (value.Length > 2000) throw new RuleException(400, "A descrição do sistema aceita até 2.000 caracteres.");
        return value;
    }

    /// <summary>GET /api/rpg-systems: somente ativos, "Sistema livre" primeiro e depois por nome.</summary>
    public async Task<object> ListActiveAsync(CancellationToken ct) =>
        await db.RpgSystems.AsNoTracking().Where(s => s.Active)
            .OrderBy(s => s.Id == RpgSystem.FreeSystemId ? 0 : 1).ThenBy(s => s.Name).ThenBy(s => s.Id)
            .Select(s => new { s.Id, s.Name, s.Slug, s.Description, s.TableSettings }).ToListAsync(ct) is var rows
            // Forma de jogar sugerida pelo sistema (pré-seleção na criação de campanha).
            ? rows.Select(s => new { s.Id, s.Name, s.Slug, s.Description, playMode = TableSettings.Parse(s.TableSettings).PlayMode }).ToList() : null!;

    /// <summary>Admin: todos os sistemas com contagem de uso.</summary>
    public async Task<object> ListAllAsync(CancellationToken ct) =>
        await db.RpgSystems.AsNoTracking()
            .OrderBy(s => s.Id == RpgSystem.FreeSystemId ? 0 : 1).ThenBy(s => s.Name).ThenBy(s => s.Id)
            .Select(s => new
            {
                s.Id,
                s.Name,
                s.Slug,
                s.Description,
                s.Active,
                s.Revision,
                s.CreatedAt,
                s.UpdatedAt,
                @protected = s.Id == RpgSystem.FreeSystemId,
                campaigns = db.Campaigns.Count(c => c.RpgSystemId == s.Id),
                templates = db.SheetTemplates.Count(t => t.RpgSystemId == s.Id),
                library = db.Library.Count(l => l.RpgSystemId == s.Id && l.DeletedAt == null),
                tableSettings = s.TableSettings,
            }).ToListAsync(ct) is var rows
            ? rows.Select(r => new
            {
                r.Id, r.Name, r.Slug, r.Description, r.Active, r.Revision, r.CreatedAt, r.UpdatedAt, r.@protected, r.campaigns, r.templates, r.library,
                tableSettings = TableSettings.Parse(r.tableSettings), tableSettingsCustom = r.tableSettings != null,
            }).ToList() : null!;

    /// <summary>Admin: configuração padrão da mesa do sistema, herdada pelas campanhas que não a ajustaram. Nula volta ao padrão da plataforma.</summary>
    public async Task<object> UpdateTableSettingsAsync(Guid id, RpgSystemTableSettingsInput x, string actor, CancellationToken ct)
    {
        var json = x.Settings?.Validate().Serialize();
        var system = await db.RpgSystems.SingleOrDefaultAsync(s => s.Id == id, ct) ?? throw new RuleException(404, "Sistema não encontrado.");
        if (system.Revision != x.Revision) throw new RuleException(409, "O sistema mudou em outra sessão. Atualize a lista antes de editar.");
        var before = system.TableSettings;
        system.TableSettings = json; system.Revision++; system.UpdatedAt = DateTime.UtcNow;
        audit.Record(actor, "system.table", "system", id.ToString(), $"Alterou a configuração da mesa do sistema {system.Name}", new { before, after = json });
        await SaveAsync(ct);
        return new { system.Id, system.Revision, tableSettings = TableSettings.Parse(json), tableSettingsCustom = json != null };
    }

    async Task EnsureUniqueAsync(string name, string slug, Guid? except, CancellationToken ct)
    {
        var lower = name.ToLower();
        if (await db.RpgSystems.AnyAsync(s => s.Id != except && s.Name.ToLower() == lower, ct)) throw new RuleException(409, "Já existe um sistema com esse nome.");
        if (await db.RpgSystems.AnyAsync(s => s.Id != except && s.Slug == slug, ct)) throw new RuleException(409, "Já existe um sistema com esse identificador (slug).");
    }

    async Task SaveAsync(CancellationToken ct)
    {
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateConcurrencyException) { throw new RuleException(409, "O sistema mudou em outra sessão. Atualize a lista antes de editar."); }
        catch (DbUpdateException) { throw new RuleException(409, "Já existe um sistema com esse nome ou identificador."); }
    }

    public async Task<object> CreateAsync(RpgSystemInput x, string actor, CancellationToken ct)
    {
        var name = CleanName(x.Name);
        var slug = string.IsNullOrWhiteSpace(x.Slug) ? Slugify(name) : x.Slug.Trim();
        if (!IsValidSlug(slug)) throw new RuleException(400, "Identificador inválido: use letras minúsculas sem acento, números e hífens (ex.: tormenta-20).");
        var description = CleanDescription(x.Description);
        await EnsureUniqueAsync(name, slug, null, ct);
        var system = new RpgSystem { Name = name, Slug = slug, Description = description };
        db.RpgSystems.Add(system);
        audit.Record(actor, "system.create", "system", system.Id.ToString(), $"Criou o sistema {name}", new { after = new { name, slug, description, active = true } });
        await SaveAsync(ct);
        return new { system.Id, system.Name, system.Slug, system.Description, system.Active, system.Revision };
    }

    public async Task<object> UpdateAsync(Guid id, RpgSystemUpdate x, string actor, CancellationToken ct)
    {
        var name = CleanName(x.Name);
        var slug = (x.Slug ?? "").Trim();
        if (!IsValidSlug(slug)) throw new RuleException(400, "Identificador inválido: use letras minúsculas sem acento, números e hífens (ex.: tormenta-20).");
        var description = CleanDescription(x.Description);
        if (id == RpgSystem.FreeSystemId && !x.Active) throw new RuleException(409, "O Sistema livre é protegido e não pode ser desativado.");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var system = await db.RpgSystems.SingleOrDefaultAsync(s => s.Id == id, ct) ?? throw new RuleException(404, "Sistema não encontrado.");
        if (system.Revision != x.Revision) throw new RuleException(409, "O sistema mudou em outra sessão. Atualize a lista antes de editar.");
        await EnsureUniqueAsync(name, slug, id, ct);
        var before = new { system.Name, system.Slug, system.Description, system.Active };
        var renamed = system.Name != name;
        system.Name = name; system.Slug = slug; system.Description = description; system.Active = x.Active;
        system.Revision++; system.UpdatedAt = DateTime.UtcNow;
        audit.Record(actor, "system.update", "system", id.ToString(), $"Alterou o sistema {name}", new { before, after = new { name, slug, description, active = x.Active } });
        await SaveAsync(ct);
        // Campaign.System é a cópia legível do nome: acompanha a renomeação na mesma transação.
        if (renamed) await db.Campaigns.Where(c => c.RpgSystemId == id).ExecuteUpdateAsync(c => c.SetProperty(p => p.System, name), ct);
        await tx.CommitAsync(ct);
        return new { system.Id, system.Name, system.Slug, system.Description, system.Active, system.Revision };
    }

    public async Task DeleteAsync(Guid id, string actor, CancellationToken ct)
    {
        if (id == RpgSystem.FreeSystemId) throw new RuleException(409, "O Sistema livre é protegido e não pode ser excluído.");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var system = await db.RpgSystems.SingleOrDefaultAsync(s => s.Id == id, ct) ?? throw new RuleException(404, "Sistema não encontrado.");
        if (await db.Campaigns.AnyAsync(c => c.RpgSystemId == id, ct) || await db.SheetTemplates.AnyAsync(t => t.RpgSystemId == id, ct) || await db.Library.AnyAsync(l => l.RpgSystemId == id, ct))
            throw new RuleException(409, "Este sistema está em uso por campanhas, fichas-modelo ou materiais da biblioteca. Desative-o em vez de excluir.");
        db.RpgSystems.Remove(system);
        audit.Record(actor, "system.delete", "system", id.ToString(), $"Excluiu o sistema {system.Name}", new { before = new { system.Name, system.Slug, system.Description, system.Active } });
        await SaveAsync(ct);
        await tx.CommitAsync(ct);
    }

    /// <summary>Resolve o sistema de uma campanha. <paramref name="current"/> é o sistema atual (edição): pode ser mantido mesmo inativo.
    /// Sem id, casa o texto pelo nome (sem diferenciar maiúsculas) com o sistema atual ou com um ativo; senão usa o Sistema livre.</summary>
    public static async Task<RpgSystem> ResolveForCampaignAsync(GameDb db, Guid? id, string? text, Guid? current, CancellationToken ct)
    {
        if (id is { } wanted)
        {
            var chosen = await db.RpgSystems.AsNoTracking().SingleOrDefaultAsync(s => s.Id == wanted, ct);
            if (chosen == null || (!chosen.Active && chosen.Id != current)) throw new RuleException(400, "Escolha um sistema de RPG ativo.");
            return chosen;
        }
        var name = (text ?? "").Trim().ToLower();
        if (name.Length > 0)
        {
            var match = await db.RpgSystems.AsNoTracking()
                .Where(s => s.Name.ToLower() == name && (s.Active || s.Id == current))
                .OrderBy(s => s.Id == current ? 0 : 1).FirstOrDefaultAsync(ct);
            if (match != null) return match;
        }
        else if (current is { } kept) return await db.RpgSystems.AsNoTracking().SingleAsync(s => s.Id == kept, ct);
        throw new RuleException(400, "Escolha explicitamente um sistema de RPG ativo, inclusive Sistema livre se desejar regras próprias.");
    }
}
