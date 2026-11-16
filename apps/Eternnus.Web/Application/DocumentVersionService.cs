using System.Text.Json;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

public record DocumentVersionInput(string Kind, Guid DocumentId, string? Label);
public record DocumentVersionLabelInput(string? Label);

/// <summary>
/// Versões persistentes dos documentos de preparação (ADR-083). Só o mestre da campanha lista, lê, nomeia e exclui.
/// As versões automáticas são gravadas pelos próprios salvamentos (<see cref="DocumentVersionModel.RecordAsync"/>).
/// </summary>
public sealed class DocumentVersionService(GameDb db, TimeProvider clock)
{
    DateTime Now => clock.GetUtcNow().UtcDateTime;
    static RuleException Missing() => new(404, "Versão não encontrada.");

    async Task MasterAsync(Guid campaign, string user, bool write, CancellationToken ct)
    {
        var c = await db.Campaigns.AsNoTracking().SingleOrDefaultAsync(x => x.Id == campaign, ct) ?? throw new RuleException(404, "Campanha não encontrada.");
        OneShotLifecycleService.EnsureOpen(c, Now);
        if (c.OwnerId != user)
        {
            if (!await db.Members.AnyAsync(m => m.CampaignId == campaign && m.UserId == user, ct)) throw new RuleException(404, "Campanha não encontrada.");
            throw new RuleException(403, "Somente o mestre vê as versões da preparação.");
        }
        if (write && c.ArchivedAt != null) throw new RuleException(409, "Restaure a campanha antes de editar a preparação.");
    }

    static string Kind(string? kind) => DocumentVersionKinds.IsValid(kind) ? kind! : throw new RuleException(400, "Tipo de documento inválido.");

    /// <summary>Versões de um documento, mais recentes primeiro (no máximo 40), sem o conteúdo.</summary>
    public async Task<object> ListAsync(Guid campaign, string? kind, Guid document, string user, CancellationToken ct)
    {
        await MasterAsync(campaign, user, false, ct);
        var k = Kind(kind);
        var items = await db.Set<DocumentVersion>().AsNoTracking().Where(v => v.CampaignId == campaign && v.Kind == k && v.DocumentId == document)
            .OrderByDescending(v => v.CreatedAt).Take(DocumentVersionModel.MaxAuto + DocumentVersionModel.MaxNamed)
            .Select(v => new { v.Id, v.Label, v.Auto, v.Revision, v.CreatedAt, v.Size }).ToListAsync(ct);
        return new { items, maxAuto = DocumentVersionModel.MaxAuto, maxNamed = DocumentVersionModel.MaxNamed };
    }

    /// <summary>Conteúdo de uma versão, para o editor carregar como rascunho.</summary>
    public async Task<object> GetAsync(Guid campaign, Guid id, string user, CancellationToken ct)
    {
        await MasterAsync(campaign, user, false, ct);
        var v = await db.Set<DocumentVersion>().AsNoTracking().SingleOrDefaultAsync(x => x.Id == id && x.CampaignId == campaign, ct) ?? throw Missing();
        using var payload = JsonDocument.Parse(v.Payload);
        return new { v.Id, v.Kind, documentId = v.DocumentId, v.Label, v.Auto, v.Revision, v.CreatedAt, payload = payload.RootElement.Clone() };
    }

    /// <summary>
    /// Guarda a versão salva atual com um nome. Se ela já existe como automática (mesmo conteúdo), passa a ser nomeada.
    /// Mapas de imagem antigos, nunca salvos pelo editor, precisam ser salvos antes (a imagem original ainda não é uma fonte).
    /// </summary>
    public async Task<object> CreateAsync(Guid campaign, string user, DocumentVersionInput x, CancellationToken ct)
    {
        var kind = Kind(x.Kind);
        var label = DocumentVersionModel.Label(x.Label);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await new CampaignAssetsService(db).Lock(campaign, user, ct);
        await MasterAsync(campaign, user, true, ct);
        string payload; int revision; IEnumerable<Guid> refs = [];
        if (kind == DocumentVersionKinds.Scene)
        {
            var scene = await db.Scenes.AsNoTracking().SingleOrDefaultAsync(s => s.Id == x.DocumentId && s.CampaignId == campaign, ct) ?? throw new RuleException(404, "Cena não encontrada.");
            payload = DocumentVersionModel.ScenePayload(scene); revision = scene.Revision;
        }
        else
        {
            var map = await db.Set<CampaignMap>().AsNoTracking().SingleOrDefaultAsync(m => m.Id == x.DocumentId && m.CampaignId == campaign && m.Purpose == CampaignAssetPurposes.Map, ct)
                ?? throw new RuleException(404, "Mapa não encontrado.");
            revision = map.Revision;
            if (kind == DocumentVersionKinds.TileMap)
            {
                if (map.TileData == null) throw new RuleException(400, "Este mapa não é de tiles.");
                payload = DocumentVersionModel.TilePayload(map);
            }
            else
            {
                if (map.TileData != null) throw new RuleException(400, "Este mapa é de tiles.");
                var doc = MapComposition.Stored(map.Composition) ?? throw new RuleException(409, "Salve o mapa no editor antes de criar uma versão.");
                payload = DocumentVersionModel.ImagePayload(map, doc);
                refs = MapComposition.Validate(doc).Sources;
            }
        }
        if (payload.Length > DocumentVersionModel.MaxPayload) throw new RuleException(409, "O documento é grande demais para guardar como versão (limite de 2 MB).");
        var rows = await db.Set<DocumentVersion>().Where(v => v.CampaignId == campaign && v.Kind == kind && v.DocumentId == x.DocumentId)
            .OrderByDescending(v => v.CreatedAt).ToListAsync(ct);
        if (rows.Count(v => !v.Auto) >= DocumentVersionModel.MaxNamed)
            throw new RuleException(409, $"Este documento já tem {DocumentVersionModel.MaxNamed} versões nomeadas. Exclua uma antes.");
        var hash = DocumentVersionModel.Hash(payload);
        var row = rows.FirstOrDefault(v => v.Hash == hash && v.Auto);
        if (row != null) { row.Auto = false; row.Label = label; }
        else
        {
            row = new DocumentVersion
            {
                CampaignId = campaign, Kind = kind, DocumentId = x.DocumentId, Label = label, Auto = false, Revision = revision, CreatedAt = Now,
                Hash = hash, Size = payload.Length, Payload = payload, Refs = DocumentVersionModel.RefsOf(refs),
            };
            db.Add(row);
            rows.Insert(0, row);
        }
        DocumentVersionModel.Retain(db, rows.OrderByDescending(v => v.CreatedAt).ToList());
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return new { row.Id, row.Label, row.Auto, row.Revision, row.CreatedAt, row.Size };
    }

    /// <summary>Renomeia (e torna nomeada) uma versão.</summary>
    public async Task<object> RenameAsync(Guid campaign, Guid id, string user, DocumentVersionLabelInput x, CancellationToken ct)
    {
        var label = DocumentVersionModel.Label(x.Label);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await new CampaignAssetsService(db).Lock(campaign, user, ct);
        await MasterAsync(campaign, user, true, ct);
        var row = await db.Set<DocumentVersion>().SingleOrDefaultAsync(v => v.Id == id && v.CampaignId == campaign, ct) ?? throw Missing();
        if (row.Auto)
        {
            var named = await db.Set<DocumentVersion>().CountAsync(v => v.CampaignId == campaign && v.Kind == row.Kind && v.DocumentId == row.DocumentId && !v.Auto, ct);
            if (named >= DocumentVersionModel.MaxNamed) throw new RuleException(409, $"Este documento já tem {DocumentVersionModel.MaxNamed} versões nomeadas. Exclua uma antes.");
        }
        row.Label = label; row.Auto = false;
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return new { row.Id, row.Label, row.Auto, row.Revision, row.CreatedAt, row.Size };
    }

    /// <summary>Exclui uma versão. As imagens-fonte que só ela usava saem no próximo salvamento do mapa.</summary>
    public async Task DeleteAsync(Guid campaign, Guid id, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await new CampaignAssetsService(db).Lock(campaign, user, ct);
        await MasterAsync(campaign, user, true, ct);
        if (await db.Set<DocumentVersion>().Where(v => v.Id == id && v.CampaignId == campaign).ExecuteDeleteAsync(ct) == 0) throw Missing();
        await tx.CommitAsync(ct);
    }

    /// <summary>Versões de um documento excluído (mapa ou cena).</summary>
    internal static Task DeleteForAsync(GameDb db, Guid campaign, Guid document, CancellationToken ct) =>
        db.Set<DocumentVersion>().Where(v => v.CampaignId == campaign && v.DocumentId == document).ExecuteDeleteAsync(ct);
}
