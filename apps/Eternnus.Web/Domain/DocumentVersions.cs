using System.ComponentModel.DataAnnotations;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

/// <summary>
/// Versão persistente de um documento de preparação (ADR-083): instantâneo do documento salvo, automático a cada salvamento
/// (deduplicado por conteúdo) ou nomeado pelo mestre. Não é o histórico de desfazer do editor (que vive só na sessão de edição).
/// Restaurar acontece no editor: o conteúdo volta como rascunho e só é gravado pelo caminho normal de salvar (mesmas
/// validações, revisão e proteções de mapa na mesa).
/// </summary>
public class DocumentVersion
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid CampaignId { get; set; }
    /// <summary><see cref="DocumentVersionKinds"/>.</summary>
    [MaxLength(12)] public string Kind { get; set; } = DocumentVersionKinds.TileMap;
    /// <summary>Mapa (<see cref="CampaignMap.Id"/>) ou cena (<see cref="Scene.Id"/>).</summary>
    public Guid DocumentId { get; set; }
    /// <summary>Nome dado pelo mestre; vazio nas automáticas.</summary>
    [MaxLength(80)] public string Label { get; set; } = "";
    public bool Auto { get; set; } = true;
    /// <summary>Revisão do documento quando a versão foi registrada (informativa).</summary>
    public int Revision { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    /// <summary>SHA-256 do conteúdo, para não repetir versões iguais.</summary>
    [MaxLength(64)] public string Hash { get; set; } = "";
    public int Size { get; set; }
    /// <summary>Imagens-fonte referenciadas (GUIDs separados por vírgula), para não apagá-las enquanto a versão existir.</summary>
    [MaxLength(1600)] public string Refs { get; set; } = "";
    /// <summary>Documento em JSON (até <see cref="DocumentVersionModel.MaxPayload"/> caracteres). Nunca contém exploração de jogadores.</summary>
    public string Payload { get; set; } = "";
}

public static class DocumentVersionKinds
{
    public const string TileMap = "tilemap", ImageMap = "imagemap", Scene = "scene";
    public static readonly string[] All = [TileMap, ImageMap, Scene];
    public static bool IsValid(string? kind) => kind != null && All.Contains(kind);
}

public static class DocumentVersionModel
{
    /// <summary>Retenção por documento: 20 automáticas e 20 nomeadas; conteúdo de até 2 MiB.</summary>
    public const int MaxAuto = 20, MaxNamed = 20, MaxLabel = 80, MaxPayload = 2 * 1024 * 1024;
    static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static void Configure(ModelBuilder b)
    {
        b.Entity<DocumentVersion>().HasOne<Campaign>().WithMany().HasForeignKey(x => x.CampaignId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<DocumentVersion>().HasIndex(x => new { x.CampaignId, x.Kind, x.DocumentId, x.CreatedAt });
    }

    public static string Hash(string payload) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(payload))).ToLowerInvariant();

    public static string Label(string? value)
    {
        var text = (value ?? "").Trim();
        if (text.Length is 0 or > MaxLabel) throw new RuleException(400, $"Dê um nome de 1 a {MaxLabel} caracteres à versão.");
        return text;
    }

    /// <summary>Mapa de tiles: mesmos campos que o editor lê de <c>GET …/tile-maps/{id}</c>.</summary>
    public static string TilePayload(CampaignMap m) => JsonSerializer.Serialize(new
    {
        name = m.Name, summary = m.Summary, scaleMeters = m.ScaleMeters,
        rows = (m.TileData ?? "").Split('\n'), layers = TileLayers.Parse(m.Composition, m.TileData ?? ""),
    }, Json);

    /// <summary>Mapa de imagem: composição salva e campos de grade (nunca a imagem achatada).</summary>
    public static string ImagePayload(CampaignMap m, CompositionDocument doc) => JsonSerializer.Serialize(new
    {
        name = m.Name, summary = m.Summary, gridPixels = m.GridPixels, scaleMeters = m.ScaleMeters, hasGrid = m.HasGrid,
        gridOffsetX = m.GridOffsetX, gridOffsetY = m.GridOffsetY, freeMovement = m.FreeMovement,
        composition = JsonSerializer.SerializeToElement(doc, EditorLayers.Json),
    }, Json);

    /// <summary>Preparação da cena (sem posições salvas da última visita nem estado ao vivo).</summary>
    public static string ScenePayload(Scene s) => JsonSerializer.Serialize(new
    {
        name = s.Name, description = s.Description, kind = s.Kind, mapKey = s.MapKey, sharedText = s.SharedText, privateNotes = s.PrivateNotes,
        visionMode = s.VisionMode, layerMode = s.LayerMode, order = s.Order, prepared = s.Prepared, layers = EditorLayers.Parse(s.Layers),
    }, Json);

    public static string RefsOf(IEnumerable<Guid> sources) => string.Join(',', sources.OrderBy(g => g).Select(g => g.ToString("N")));
    public static IEnumerable<Guid> ParseRefs(string? refs) =>
        (refs ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries).Select(s => Guid.TryParse(s, out var g) ? g : Guid.Empty).Where(g => g != Guid.Empty);

    /// <summary>
    /// Registra o documento salvo como versão automática (se mudou desde a última) e aplica a retenção.
    /// Chamado dentro da transação de salvamento, antes de <c>SaveChanges</c>. Devolve as imagens-fonte ainda
    /// referenciadas por versões retidas (o salvamento não as apaga).
    /// </summary>
    public static async Task<HashSet<Guid>> RecordAsync(GameDb db, Guid campaign, string kind, Guid document, int revision, string payload,
        IEnumerable<Guid>? sources, DateTime now, CancellationToken ct)
    {
        var rows = await db.Set<DocumentVersion>().Where(v => v.CampaignId == campaign && v.Kind == kind && v.DocumentId == document)
            .OrderByDescending(v => v.CreatedAt).ToListAsync(ct);
        var hash = Hash(payload);
        if (payload.Length <= MaxPayload && rows.FirstOrDefault()?.Hash != hash)
        {
            var row = new DocumentVersion
            {
                CampaignId = campaign, Kind = kind, DocumentId = document, Revision = revision, CreatedAt = now,
                Hash = hash, Size = payload.Length, Payload = payload, Refs = RefsOf(sources ?? []),
            };
            db.Add(row);
            rows.Insert(0, row);
        }
        return Retain(db, rows);
    }

    /// <summary>Remove o que passou da retenção (mais antigas primeiro) e devolve as fontes referenciadas pelas que ficam.</summary>
    internal static HashSet<Guid> Retain(GameDb db, List<DocumentVersion> newestFirst)
    {
        var keep = new HashSet<Guid>();
        int auto = 0, named = 0;
        foreach (var v in newestFirst)
        {
            var over = v.Auto ? ++auto > MaxAuto : ++named > MaxNamed;
            if (over) { db.Remove(v); continue; }
            foreach (var g in ParseRefs(v.Refs)) keep.Add(g);
        }
        return keep;
    }
}
