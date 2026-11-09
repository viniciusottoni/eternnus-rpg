using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

public static class SceneKinds
{
    public const string Map = "map", Image = "image", Text = "text";
    public static readonly string[] All = [Map, Image, Text];
}

/// <summary>Visão simplificada: tudo visível, revelação manual ou visão por personagem. Nula = configuração da mesa.</summary>
public static class VisionModes
{
    public const string All = "all", Manual = "manual", Character = "character";
    public static bool IsValid(string? v) => v is null or All or Manual or Character;
}

/// <summary>Marcador guardado numa cena (preparado ou estado salvo para retomar).</summary>
public sealed class SceneToken
{
    public Guid? CharacterId { get; set; }
    public Guid? MasterCharacterId { get; set; }
    [MaxLength(40)] public string Label { get; set; } = "";
    [MaxLength(10)] public string Side { get; set; } = "enemy";
    public int X { get; set; }
    public int Y { get; set; }
    public bool Hidden { get; set; }
    public int? Light { get; set; }
}

/// <summary>
/// Cena preparada pelo mestre. Referencia mapas oficiais/da campanha pela chave (sem copiar arquivos).
/// <see cref="Prepared"/> é o arranjo inicial; <see cref="Saved"/> é o estado deixado ao trocar de cena (para retomar).
/// </summary>
public class Scene
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid CampaignId { get; set; }
    [MaxLength(80)] public string Name { get; set; } = "";
    /// <summary>Descrição de preparo (mestre).</summary>
    [MaxLength(1000)] public string Description { get; set; } = "";
    [MaxLength(10)] public string Kind { get; set; } = SceneKinds.Map;
    [MaxLength(20)] public string MapKind { get; set; } = "";
    [MaxLength(80)] public string MapKey { get; set; } = "";
    /// <summary>Texto mostrado aos jogadores ao apresentar a cena.</summary>
    [MaxLength(2000)] public string SharedText { get; set; } = "";
    /// <summary>Notas privadas do mestre; nunca vão para jogadores.</summary>
    [MaxLength(4000)] public string PrivateNotes { get; set; } = "";
    [MaxLength(10)] public string? VisionMode { get; set; }
    /// <summary>Alcance da preparação do mapa (<see cref="SceneLayerModes"/>): compartilhada com o mapa (padrão anterior) ou própria desta cena.</summary>
    [MaxLength(10)] public string LayerMode { get; set; } = SceneLayerModes.Map;
    public List<SceneToken> Prepared { get; set; } = [];
    public List<SceneToken> Saved { get; set; } = [];
    public bool HasSaved { get; set; }
    public int Order { get; set; }
    public int Revision { get; set; } = 1;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>Recurso configurável de um personagem do mestre (vida, estresse, munição…).</summary>
public sealed class NpcResource
{
    [MaxLength(40)] public string Label { get; set; } = "";
    public int Value { get; set; }
    public int? Max { get; set; }
}

/// <summary>Personagem do mestre reutilizável. Cópias de encontro guardam a origem e não alteram o original.</summary>
public class MasterCharacter
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid CampaignId { get; set; }
    [MaxLength(40)] public string Name { get; set; } = "";
    [MaxLength(500)] public string Summary { get; set; } = "";
    [MaxLength(4000)] public string Notes { get; set; } = "";
    [MaxLength(10)] public string Side { get; set; } = "enemy";
    public List<NpcResource> Resources { get; set; } = [];
    public Guid? SourceId { get; set; }
    public int Revision { get; set; } = 1;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    /// <summary>Personagem do mestre ("npc") ou criatura ("creature"). Só muda a apresentação e a organização.</summary>
    [MaxLength(10)] public string Kind { get; set; } = NpcKinds.Npc;
    /// <summary>Versão do modelo de ficha (o mesmo dos jogadores ou outro da campanha). Nula = sem ficha, só recursos simples.</summary>
    public Guid? TemplateVersionId { get; set; }
    /// <summary>Valores editáveis da ficha (JSON nome → texto), validados pelo modelo.</summary>
    [MaxLength(100000)] public string Values { get; set; } = "{}";
    /// <summary>Imagem mostrada aos jogadores quando o marcador está visível: https://… ou asset:{id} (imagem do acervo da campanha).</summary>
    [MaxLength(500)] public string? ImageUrl { get; set; }
}

public static class NpcKinds
{
    public const string Npc = "npc", Creature = "creature";
    public static string Normalize(string? v) => v switch { null or "" => Npc, Npc or Creature => v, _ => throw new RuleException(400, "Escolha personagem ou criatura.") };
}

/// <summary>
/// Imagem de NPC/criatura: link https (sem credenciais, até 500 caracteres) ou asset:{guid} de uma imagem do acervo da
/// própria campanha. Links externos carregam do site de terceiros no navegador dos jogadores (o site vê o IP deles).
/// </summary>
public static class NpcImages
{
    public const string AssetPrefix = "asset:";
    /// <summary>Normaliza a entrada. Devolve null (sem imagem), o link https canônico ou asset:{guid}; a existência do asset é conferida pelo serviço.</summary>
    public static string? Normalize(string? input, out Guid? asset)
    {
        asset = null;
        var text = (input ?? "").Trim();
        if (text.Length == 0) return null;
        if (text.StartsWith(AssetPrefix, StringComparison.Ordinal))
        {
            if (!Guid.TryParse(text[AssetPrefix.Length..], out var id)) throw new RuleException(400, "Imagem do acervo inválida.");
            asset = id;
            return AssetPrefix + id.ToString("D");
        }
        if (text.Length > 500 || text.Any(ch => char.IsWhiteSpace(ch) || char.IsControl(ch))
            || !Uri.TryCreate(text, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps || uri.Host.Length == 0 || uri.UserInfo.Length > 0)
            throw new RuleException(400, "Use um link https:// válido para a imagem (até 500 caracteres) ou escolha uma imagem do acervo.");
        return uri.AbsoluteUri.Length > 500 ? throw new RuleException(400, "O link da imagem aceita até 500 caracteres.") : uri.AbsoluteUri;
    }
}

/// <summary>Resposta de um personagem a um pedido de teste. A sessão bloqueada impede respostas duplicadas.</summary>
public sealed class RollRequestTarget
{
    public Guid CharacterId { get; set; }
    [MaxLength(450)] public string UserId { get; set; } = "";
    [MaxLength(100)] public string Name { get; set; } = "";
    public DateTime? RespondedAt { get; set; }
    public double? Total { get; set; }
    [MaxLength(10)] public string? Outcome { get; set; }
    [MaxLength(300)] public string? Detail { get; set; }
}

/// <summary>Pedido de teste do mestre a personagens selecionados.</summary>
public class RollRequest
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid SessionId { get; set; }
    [MaxLength(80)] public string Label { get; set; } = "";
    [MaxLength(300)] public string Formula { get; set; } = "";
    [MaxLength(1000)] public string? Spec { get; set; }
    [MaxLength(10)] public string Visibility { get; set; } = RollVisibility.Table;
    public int? Target { get; set; }
    [MaxLength(5)] public string? Rule { get; set; }
    public List<RollRequestTarget> Targets { get; set; } = [];
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? CancelledAt { get; set; }
    public DateTime? ClosedAt { get; set; }

    static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public DiceSpec? ParsedSpec() { try { return Spec == null ? null : JsonSerializer.Deserialize<DiceSpec>(Spec, Json); } catch (JsonException) { return null; } }
    public static string SerializeSpec(DiceSpec s) => JsonSerializer.Serialize(s, Json);
}

public static class AttendanceStatuses
{
    public const string Yes = "yes", No = "no", Maybe = "maybe";
    public static bool IsValid(string? s) => s is Yes or No or Maybe;
}

/// <summary>Confirmação de presença para a próxima partida. Vale enquanto <see cref="SessionAt"/> coincidir com a data marcada.</summary>
public class CampaignAttendance
{
    public Guid CampaignId { get; set; }
    [MaxLength(450)] public string UserId { get; set; } = "";
    public DateTime SessionAt { get; set; }
    [MaxLength(10)] public string Status { get; set; } = AttendanceStatuses.Maybe;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public static class PreparationModel
{
    public static void Configure(ModelBuilder b)
    {
        b.Entity<Scene>().HasOne<Campaign>().WithMany().HasForeignKey(x => x.CampaignId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<Scene>().HasIndex(x => new { x.CampaignId, x.Order });
        b.Entity<Scene>().Property(x => x.Revision).IsConcurrencyToken();
        b.Entity<Scene>().OwnsMany(x => x.Prepared, o => o.ToJson());
        b.Entity<Scene>().OwnsMany(x => x.Saved, o => o.ToJson());
        b.Entity<MasterCharacter>().HasOne<Campaign>().WithMany().HasForeignKey(x => x.CampaignId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<MasterCharacter>().HasIndex(x => new { x.CampaignId, x.Name });
        b.Entity<MasterCharacter>().Property(x => x.Revision).IsConcurrencyToken();
        b.Entity<MasterCharacter>().OwnsMany(x => x.Resources, o => o.ToJson());
        b.Entity<RollRequest>().HasOne<GameSession>().WithMany().HasForeignKey(x => x.SessionId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<RollRequest>().HasIndex(x => new { x.SessionId, x.CreatedAt });
        b.Entity<RollRequest>().OwnsMany(x => x.Targets, o => o.ToJson());
        b.Entity<CampaignAttendance>().HasKey(x => new { x.CampaignId, x.UserId });
        b.Entity<CampaignAttendance>().HasOne<Campaign>().WithMany().HasForeignKey(x => x.CampaignId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<CampaignAttendance>().HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<GameSession>().HasOne<Scene>().WithMany().HasForeignKey(x => x.SceneId).OnDelete(DeleteBehavior.SetNull);
        b.Entity<SessionToken>().HasOne<MasterCharacter>().WithMany().HasForeignKey(x => x.MasterCharacterId).OnDelete(DeleteBehavior.SetNull);
        // SheetTemplate.CampaignId não tem FK: fichas pessoais continuam presas à versão mesmo depois de a campanha ser excluída.
        b.Entity<Campaign>().HasIndex(x => new { x.OwnerId, x.ArchivedAt });
    }
}
