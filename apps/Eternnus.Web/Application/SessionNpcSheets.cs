using System.Text.Json;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

public record NpcSheetInput(Guid? TemplateId, Dictionary<string, string?>? Values, int Revision);

/// <summary>
/// Fichas de NPCs e criaturas: o mestre escolhe qualquer modelo permitido às fichas da campanha (o dos jogadores ou outro)
/// e acompanha os valores durante a sessão. Somente o mestre lê ou grava. Com sessão ativa, a gravação segue o fluxo da mesa:
/// bloqueia sessão → personagem, grava evento privado, incrementa a revisão e sinaliza após o commit.
/// </summary>
public partial class SessionService
{
    /// <summary>Modelos que a campanha aceita: do sistema da campanha (catálogo ou privados desta campanha) e o do Sistema livre.</summary>
    IQueryable<SheetTemplate> AllowedTemplates(Campaign c) =>
        db.SheetTemplates.AsNoTracking().Where(t => t.ArchivedAt == null && t.CurrentVersionId != null
            && ((t.RpgSystemId == c.RpgSystemId && (t.CampaignId == null || t.CampaignId == c.Id)) || t.Id == SheetTemplate.FreeTemplateId)
            && db.SheetTemplateVersions.Any(v => v.Id == t.CurrentVersionId && v.PublishedAt != null));

    public async Task<object> NpcTemplatesAsync(Guid campaignId, string user, CancellationToken ct)
    {
        var (c, master) = await CampaignAccessAsync(campaignId, user, ct);
        if (!master) throw new RuleException(403, "Somente o mestre prepara fichas de NPCs e criaturas.");
        var items = await AllowedTemplates(c).OrderBy(t => t.CampaignId == null).ThenBy(t => t.Name).Take(100)
            .Select(t => new { t.Id, t.Name, campaign = t.CampaignId != null, playerDefault = t.Id == c.SheetTemplateId }).ToListAsync(ct);
        return new { items };
    }

    async Task<MasterCharacter> MasterNpcAsync(Guid campaignId, Guid npcId, string user, bool tracking, CancellationToken ct)
    {
        var (_, master) = await CampaignAccessAsync(campaignId, user, ct);
        if (!master) throw new RuleException(403, "Somente o mestre vê fichas de NPCs e criaturas.");
        var query = tracking ? db.MasterCharacters : db.MasterCharacters.AsNoTracking();
        return await query.SingleOrDefaultAsync(m => m.Id == npcId && m.CampaignId == campaignId, ct) ?? throw new RuleException(404, "Personagem do mestre não encontrado.");
    }

    object NpcSheetView(MasterCharacter npc, SheetTemplate? template, SheetTemplateVersion? version)
    {
        if (version == null || template == null)
            return new { npc.Id, npc.Name, npc.Kind, npc.Revision, npc.ImageUrl, template = (object?)null, fields = Array.Empty<object>(), values = new Dictionary<string, string>(), resources = Array.Empty<object>(), stats = Array.Empty<object>() };
        var all = CharacterSheets.All(version.Fields, CharacterSheets.Complete(version.Fields, CharacterSheets.ParseValues(npc.Values)).Stored);
        var (resources, stats) = SheetSummary.Build(version.Fields, all);
        return new
        {
            npc.Id, npc.Name, npc.Kind, npc.Revision, npc.ImageUrl,
            template = new { template.Id, template.Name, versionId = version.Id },
            fields = version.Fields.Select(f => new { f.Name, f.Label, f.Type, f.Options, f.Min, f.Max, f.Section, f.MaxLength }),
            values = all, resources, stats,
        };
    }

    public async Task<object> NpcSheetAsync(Guid campaignId, Guid npcId, string user, CancellationToken ct)
    {
        var npc = await MasterNpcAsync(campaignId, npcId, user, false, ct);
        if (npc.TemplateVersionId is not { } versionId) return NpcSheetView(npc, null, null);
        var version = await db.SheetTemplateVersions.AsNoTracking().SingleOrDefaultAsync(v => v.Id == versionId, ct);
        var template = version == null ? null : await db.SheetTemplates.AsNoTracking().SingleOrDefaultAsync(t => t.Id == version.TemplateId, ct);
        return NpcSheetView(npc, template, version);
    }

    /// <summary>Define o modelo (trocar recomeça os valores pelos padrões do novo modelo) e grava os valores validados pelo tipo de cada campo.</summary>
    public async Task<object> SaveNpcSheetAsync(Guid campaignId, Guid npcId, NpcSheetInput x, string user, CancellationToken ct)
    {
        var (c, master) = await CampaignAccessAsync(campaignId, user, ct);
        if (!master) throw new RuleException(403, "Somente o mestre edita fichas de NPCs e criaturas.");
        if (c.ArchivedAt != null) throw new RuleException(409, "Esta campanha está arquivada. Restaure-a para editar fichas.");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        // Ordem comum: sessão ativa → personagem do mestre.
        var active = db.Database.IsNpgsql()
            ? await db.Sessions.FromSqlInterpolated($"SELECT * FROM \"Sessions\" WHERE \"CampaignId\" = {campaignId} AND \"EndedAt\" IS NULL FOR UPDATE").SingleOrDefaultAsync(ct)
            : await db.Sessions.SingleOrDefaultAsync(s => s.CampaignId == campaignId && s.EndedAt == null, ct);
        var npc = db.Database.IsNpgsql()
            ? await db.MasterCharacters.FromSqlInterpolated($"SELECT * FROM \"MasterCharacters\" WHERE \"Id\" = {npcId} AND \"CampaignId\" = {campaignId} FOR UPDATE").SingleOrDefaultAsync(ct)
            : await db.MasterCharacters.SingleOrDefaultAsync(m => m.Id == npcId && m.CampaignId == campaignId, ct);
        if (npc == null) throw new RuleException(404, "Personagem do mestre não encontrado.");
        if (npc.Revision != x.Revision) throw new RuleException(409, "A ficha mudou em outra tela. Recarregue antes de salvar.");
        SheetTemplate? template = null; SheetTemplateVersion? version = null;
        if (x.TemplateId is { } templateId)
        {
            template = await AllowedTemplates(c).SingleOrDefaultAsync(t => t.Id == templateId, ct) ?? throw new RuleException(404, "Ficha-modelo não encontrada para esta campanha.");
            var keep = npc.TemplateVersionId is { } currentVersion && await db.SheetTemplateVersions.AnyAsync(v => v.Id == currentVersion && v.TemplateId == templateId, ct);
            version = await db.SheetTemplateVersions.AsNoTracking().SingleAsync(v => v.Id == (keep ? npc.TemplateVersionId!.Value : template.CurrentVersionId!.Value), ct);
            var raw = keep ? CharacterSheets.ParseValues(npc.Values) : new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var (name, value) in x.Values ?? [])
            {
                var field = version.Fields.FirstOrDefault(f => f.Name == name) ?? throw new RuleException(400, "A ficha recebeu um campo que não existe no modelo.");
                if (field.Type == SheetFieldTypes.Computed) continue;
                raw[name] = CharacterSheets.ValidateValue(field, value);
            }
            npc.TemplateVersionId = version.Id;
            npc.Values = JsonSerializer.Serialize(CharacterSheets.Complete(version.Fields, raw).Stored);
        }
        else { npc.TemplateVersionId = null; npc.Values = "{}"; }
        npc.Revision++; npc.UpdatedAt = Now;
        if (active != null)
        {
            Event(active, user, await NameAsync(user, ct), EventKinds.Sheet, $"Mestre atualizou a ficha de {npc.Name}", new { npcId }, masterOnly: true);
            await CommitAsync(tx, active, ct);
        }
        else
        {
            try { await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); }
            catch (DbUpdateConcurrencyException) { throw new RuleException(409, "A ficha mudou em outra tela. Recarregue antes de salvar."); }
        }
        return NpcSheetView(npc, template, version);
    }

    /// <summary>Endereço que o cliente usa para a imagem do marcador: o link https ou a rota protegida da imagem do acervo.</summary>
    static string? PortraitUrl(Guid sessionId, Guid tokenId, string? imageUrl) =>
        imageUrl == null ? null : imageUrl.StartsWith(NpcImages.AssetPrefix, StringComparison.Ordinal) ? $"/api/sessions/{sessionId}/tokens/{tokenId}/portrait" : imageUrl;

    /// <summary>Imagens dos marcadores de NPC/criatura desta sessão (tokenId → endereço para o cliente).</summary>
    async Task<Dictionary<Guid, string>> PortraitsAsync(Guid sessionId, CancellationToken ct) =>
        (await db.SessionTokens.AsNoTracking().Where(t => t.SessionId == sessionId && t.MasterCharacterId != null)
            .Join(db.MasterCharacters, t => t.MasterCharacterId, m => m.Id, (t, m) => new { t.Id, m.ImageUrl }).Where(x => x.ImageUrl != null).ToListAsync(ct))
        .ToDictionary(x => x.Id, x => PortraitUrl(sessionId, x.Id, x.ImageUrl)!);

    /// <summary>Imagem do acervo de um NPC no mapa. Jogador só recebe se o marcador estiver visível para ele (e não apenas percebido).</summary>
    public async Task<byte[]> PortraitAsync(Guid sessionId, Guid tokenId, string user, CancellationToken ct)
    {
        var a = await SessionAccessAsync(sessionId, user, ct);
        var token = await db.SessionTokens.AsNoTracking().SingleOrDefaultAsync(t => t.Id == tokenId && t.SessionId == sessionId && t.MasterCharacterId != null, ct) ?? throw new RuleException(404, "Imagem não encontrada.");
        var image = await db.MasterCharacters.AsNoTracking().Where(m => m.Id == token.MasterCharacterId && m.CampaignId == a.Campaign.Id).Select(m => m.ImageUrl).SingleOrDefaultAsync(ct);
        NpcImages.Normalize(image, out var asset);
        if (asset is not { } assetId) throw new RuleException(404, "Imagem não encontrada.");
        if (!a.IsMaster)
        {
            if (!await db.SessionParticipants.AnyAsync(p => p.SessionId == sessionId && p.UserId == user && !p.IsMaster, ct)) throw new RuleException(404, "Imagem não encontrada.");
            if (await Fog.SceneAsync(a.Session, a.Campaign, false, ct) is { Active: true } scene)
            {
                var view = scene.View(user);
                if (!view.Tokens.Contains(tokenId) || view.PerceivedTokens.Contains(tokenId)) throw new RuleException(404, "Imagem não encontrada.");
            }
            else if (token.Hidden) throw new RuleException(404, "Imagem não encontrada.");
        }
        return await db.Set<CampaignMap>().AsNoTracking().Where(m => m.Id == assetId && m.CampaignId == a.Campaign.Id).Select(m => m.Content).SingleOrDefaultAsync(ct)
            ?? throw new RuleException(404, "Imagem não encontrada.");
    }
}
