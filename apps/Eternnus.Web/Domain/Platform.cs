using System.ComponentModel.DataAnnotations;
namespace Eternnus.Web;

// Entidades da plataforma (papéis, sistemas, auditoria, suporte, biblioteca, fichas-modelo, Guilda e progressão).
// Esquema criado pela migração PlatformFoundation. Regras ficam nos serviços de Application/ e em Domain/ puros.

/// <summary>Papéis globais. Gravados em <see cref="AppUser.Role"/> e sempre lidos do banco na autorização.</summary>
public static class PlatformRoles
{
    public const string Common = "common";
    public const string Ambassador = "ambassador";
    public const string Admin = "admin";
    public static readonly string[] All = [Common, Ambassador, Admin];
    public static bool IsStaff(string? role) => role is Admin or Ambassador;
    public static bool IsValid(string? role) => role is Common or Ambassador or Admin;
}

/// <summary>Sistema de RPG (3D&amp;T, Tormenta20, D&amp;D 5e…). Campanhas e fichas-modelo dependem dele.</summary>
public class RpgSystem
{
    /// <summary>Identificador fixo do "Sistema livre", criado pela migração e protegido contra exclusão.</summary>
    public static readonly Guid FreeSystemId = Guid.Parse("00000000-0000-4000-8000-000000000001");
    public Guid Id { get; set; } = Guid.NewGuid();
    [MaxLength(80)] public string Name { get; set; } = "";
    /// <summary>Identificador estável em minúsculas (a-z, 0-9, hífen). Único.</summary>
    [MaxLength(60)] public string Slug { get; set; } = "";
    [MaxLength(2000)] public string Description { get; set; } = "";
    /// <summary>Inativo: não aparece para novas campanhas, mas campanhas existentes continuam funcionando.</summary>
    public bool Active { get; set; } = true;
    /// <summary>Configuração padrão da mesa (<see cref="TableSettings"/>) herdada pelas campanhas do sistema. Nula = padrão da plataforma.</summary>
    [MaxLength(4000)] public string? TableSettings { get; set; }
    public int Revision { get; set; } = 1;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>Registro imutável de toda ação administrativa, de embaixador e de moderação.</summary>
public class AuditEntry
{
    public long Id { get; set; }
    [MaxLength(450)] public string ActorId { get; set; } = "";
    /// <summary>Ex.: user.role, system.update, library.upload, template.publish, guild.post.delete.</summary>
    [MaxLength(60)] public string Action { get; set; } = "";
    [MaxLength(40)] public string TargetType { get; set; } = "";
    [MaxLength(80)] public string TargetId { get; set; } = "";
    [MaxLength(300)] public string Summary { get; set; } = "";
    /// <summary>JSON com antes/depois quando houver. Nunca contém segredo, token ou e-mail de terceiros.</summary>
    [MaxLength(20000)] public string Data { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

// ---------- Suporte ----------
public static class TicketStatuses
{
    public const string Open = "open", InProgress = "in_progress", WaitingUser = "waiting_user", Resolved = "resolved", Closed = "closed";
    public static readonly string[] All = [Open, InProgress, WaitingUser, Resolved, Closed];
}
public static class TicketPriorities
{
    public const string Low = "low", Normal = "normal", High = "high", Urgent = "urgent";
    public static readonly string[] All = [Low, Normal, High, Urgent];
}
public static class TicketCategories
{
    public const string Account = "account", Bug = "bug", Campaign = "campaign", Sheet = "sheet", Abuse = "abuse", Suggestion = "suggestion", Other = "other";
    public static readonly string[] All = [Account, Bug, Campaign, Sheet, Abuse, Suggestion, Other];
}
public class SupportTicket
{
    public Guid Id { get; set; } = Guid.NewGuid();
    /// <summary>Número sequencial legível (#123), gerado pelo banco.</summary>
    public int Number { get; set; }
    [MaxLength(450)] public string AuthorId { get; set; } = "";
    [MaxLength(120)] public string Subject { get; set; } = "";
    [MaxLength(20)] public string Category { get; set; } = TicketCategories.Other;
    [MaxLength(20)] public string Priority { get; set; } = TicketPriorities.Normal;
    [MaxLength(20)] public string Status { get; set; } = TicketStatuses.Open;
    [MaxLength(450)] public string? AssignedToId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ClosedAt { get; set; }
    public int Revision { get; set; } = 1;
}
public class TicketMessage
{
    public long Id { get; set; }
    public Guid TicketId { get; set; }
    [MaxLength(450)] public string AuthorId { get; set; } = "";
    [MaxLength(10000)] public string Body { get; set; } = "";
    /// <summary>Nota interna da equipe: nunca enviada ao autor do ticket.</summary>
    public bool Internal { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

// ---------- Arquivos ----------
/// <summary>Conteúdo binário verificado (biblioteca, PDFs de fichas-modelo). Servido somente por endpoints autorizados.</summary>
public class StoredFile
{
    public Guid Id { get; set; } = Guid.NewGuid();
    [MaxLength(100)] public string ContentType { get; set; } = "";
    public long Size { get; set; }
    /// <summary>SHA-256 em hexadecimal minúsculo.</summary>
    [MaxLength(64)] public string Sha256 { get; set; } = "";
    public byte[] Content { get; set; } = [];
    [MaxLength(450)] public string UploadedById { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

// ---------- Biblioteca ----------
public static class LibraryCategories
{
    public const string Rules = "rules", Adventure = "adventure", Map = "map", Sheet = "sheet", Art = "art", Other = "other";
    public static readonly string[] All = [Rules, Adventure, Map, Sheet, Art, Other];
}
public class LibraryItem
{
    public Guid Id { get; set; } = Guid.NewGuid();
    /// <summary>Nulo: material geral, válido para qualquer sistema.</summary>
    public Guid? RpgSystemId { get; set; }
    [MaxLength(120)] public string Title { get; set; } = "";
    [MaxLength(2000)] public string Description { get; set; } = "";
    [MaxLength(20)] public string Category { get; set; } = LibraryCategories.Other;
    /// <summary>Nome original saneado (sem caminho, sem caracteres de controle).</summary>
    [MaxLength(160)] public string FileName { get; set; } = "";
    public Guid FileId { get; set; }
    [MaxLength(450)] public string CreatedById { get; set; } = "";
    [MaxLength(450)] public string UpdatedById { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    /// <summary>Exclusão lógica: some da biblioteca, pode ser restaurado pelo admin (reverter).</summary>
    public DateTime? DeletedAt { get; set; }
    public int Downloads { get; set; }
    public int Revision { get; set; } = 1;
}

// ---------- Fichas-modelo ----------
public class SheetTemplate
{
    /// <summary>Modelo embutido do Sistema livre (equivale à ficha clássica de atributos).</summary>
    public static readonly Guid FreeTemplateId = Guid.Parse("00000000-0000-4000-8000-000000000101");
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid RpgSystemId { get; set; }
    /// <summary>Modelo privado da campanha: fora do catálogo, editável só pelo mestre dela, sem privilégio de equipe.</summary>
    public Guid? CampaignId { get; set; }
    [MaxLength(100)] public string Name { get; set; } = "";
    [MaxLength(2000)] public string Description { get; set; } = "";
    /// <summary>Versão publicada mais recente; nula enquanto só houver rascunho.</summary>
    public Guid? CurrentVersionId { get; set; }
    /// <summary>Modelo padrão do sistema para novas fichas (no máximo um por sistema, garantido no serviço).</summary>
    public bool IsDefault { get; set; }
    public DateTime? ArchivedAt { get; set; }
    [MaxLength(450)] public string CreatedById { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public int Revision { get; set; } = 1;
}
/// <summary>Versão imutável depois de publicada. Fichas de jogadores ficam presas a uma versão.</summary>
public class SheetTemplateVersion
{
    public static readonly Guid FreeTemplateV1Id = Guid.Parse("00000000-0000-4000-8000-000000000102");
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TemplateId { get; set; }
    public int Number { get; set; }
    /// <summary>PDF de fundo; nulo para modelos sem PDF (página em branco do tamanho de <see cref="Pages"/>).</summary>
    public Guid? PdfFileId { get; set; }
    /// <summary>Páginas e tamanhos em pontos PDF. Coordenadas dos campos são normalizadas (0..1) por página.</summary>
    public List<SheetPage> Pages { get; set; } = [];
    public List<SheetField> Fields { get; set; } = [];
    /// <summary>Golpes/magias/habilidades predefinidos pelo modelo; o jogador pode acrescentar os seus.</summary>
    public List<SheetActionDefinition> Actions { get; set; } = [];
    [MaxLength(1000)] public string Notes { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    /// <summary>Nulo = rascunho (editável). Publicada = imutável.</summary>
    public DateTime? PublishedAt { get; set; }
    [MaxLength(450)] public string? PublishedById { get; set; }
    public int Revision { get; set; } = 1;
}
public class SheetPage
{
    public int Index { get; set; }
    public double Width { get; set; } = 595.28;
    public double Height { get; set; } = 841.89;
}
public static class SheetFieldTypes
{
    public const string Text = "text", Number = "number", TextArea = "textarea", Checkbox = "checkbox", Select = "select", Computed = "computed";
    public static readonly string[] All = [Text, Number, TextArea, Checkbox, Select, Computed];
}
/// <summary>Papéis que ligam um campo à mesa ao vivo. A ficha sincroniza esses valores nas colunas clássicas de <see cref="Character"/>.</summary>
public static class SheetFieldRoles
{
    public const string Name = "name", Level = "level", Hp = "hp", MaxHp = "maxHp", Movement = "movement", Armor = "armor",
        Light = "light", Vision = "vision", Perception = "perception", Senses = "senses", Reach = "reach";
    public static readonly string[] All = [Name, Level, Hp, MaxHp, Movement, Armor, Light, Vision, Perception, Senses, Reach];
    /// <summary>Papéis de texto (os demais, exceto <see cref="Name"/>, exigem número ou cálculo).</summary>
    public static bool IsText(string? role) => role is Name or Senses;
}
public class SheetField
{
    /// <summary>Identificador rastreável: ^[a-z][a-z0-9_]{0,39}$, único no modelo. Usado nas fórmulas como @nome e no histórico.</summary>
    [MaxLength(40)] public string Name { get; set; } = "";
    [MaxLength(80)] public string Label { get; set; } = "";
    [MaxLength(20)] public string Type { get; set; } = SheetFieldTypes.Text;
    [MaxLength(20)] public string? Role { get; set; }
    public int Page { get; set; }
    public double X { get; set; }
    public double Y { get; set; }
    public double W { get; set; }
    public double H { get; set; }
    /// <summary>Somente para <see cref="SheetFieldTypes.Computed"/>: fórmula determinística (sem dados).</summary>
    [MaxLength(300)] public string? Formula { get; set; }
    [MaxLength(200)] public string? Default { get; set; }
    public double? Min { get; set; }
    public double? Max { get; set; }
    public int? MaxLength { get; set; }
    public List<string> Options { get; set; } = [];
    public double FontSize { get; set; } = 10;
    [MaxLength(10)] public string Align { get; set; } = "left";
    /// <summary>Ficha resumida: "resource" (contador ajustável na mesa) ou "summary" (destaque). Nulo = só ficha completa.</summary>
    [MaxLength(20)] public string? Track { get; set; }
    /// <summary>Recurso: campo que guarda o teto (ex.: vida_max). Sem ele vale <see cref="Max"/>.</summary>
    [MaxLength(40)] public string? MaxField { get; set; }
    /// <summary>Seção na apresentação simples (modelos sem PDF).</summary>
    [MaxLength(60)] public string? Section { get; set; }
}
public class SheetActionDefinition
{
    [MaxLength(40)] public string Key { get; set; } = "";
    [MaxLength(60)] public string Name { get; set; } = "";
    [MaxLength(20)] public string Kind { get; set; } = ActionKinds.Attack;
    /// <summary>Fórmula com dados (ex.: 1d20 + @forca_mod; 2d6kh1 + floor(@nivel / 2)).</summary>
    [MaxLength(300)] public string Formula { get; set; } = "";
    [MaxLength(300)] public string Description { get; set; } = "";
    [MaxLength(30)] public string? Group { get; set; }
}
/// <summary>Histórico individual por campo da ficha de jogador.</summary>
public class CharacterFieldChange
{
    public long Id { get; set; }
    public Guid CharacterId { get; set; }
    [MaxLength(40)] public string Field { get; set; } = "";
    [MaxLength(2000)] public string OldValue { get; set; } = "";
    [MaxLength(2000)] public string NewValue { get; set; } = "";
    [MaxLength(450)] public string ChangedById { get; set; } = "";
    public Guid? SessionId { get; set; }
    public Guid? TemplateVersionId { get; set; }
    /// <summary>edit | migration | table | master</summary>
    [MaxLength(20)] public string Source { get; set; } = "edit";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

// ---------- Guilda ----------
public class GuildCategory
{
    public Guid Id { get; set; } = Guid.NewGuid();
    [MaxLength(60)] public string Name { get; set; } = "";
    [MaxLength(60)] public string Slug { get; set; } = "";
    [MaxLength(300)] public string Description { get; set; } = "";
    public int Order { get; set; }
    /// <summary>Nível mínimo para abrir tópicos nesta categoria (responder nunca exige nível).</summary>
    public int MinLevelToPost { get; set; } = 1;
    /// <summary>Somente equipe abre tópicos (ex.: Avisos).</summary>
    public bool StaffOnly { get; set; }
    public DateTime? ArchivedAt { get; set; }
}
public class GuildTopic
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid CategoryId { get; set; }
    public Guid? RpgSystemId { get; set; }
    [MaxLength(450)] public string AuthorId { get; set; } = "";
    [MaxLength(140)] public string Title { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime LastPostAt { get; set; } = DateTime.UtcNow;
    public int PostCount { get; set; }
    public bool Pinned { get; set; }
    public bool Locked { get; set; }
    public DateTime? DeletedAt { get; set; }
    public int Revision { get; set; } = 1;
}
public class GuildPost
{
    public long Id { get; set; }
    public Guid TopicId { get; set; }
    [MaxLength(450)] public string AuthorId { get; set; } = "";
    /// <summary>Texto puro (exibido com escape; quebras de linha preservadas).</summary>
    [MaxLength(10000)] public string Body { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? EditedAt { get; set; }
    public DateTime? DeletedAt { get; set; }
    [MaxLength(450)] public string? DeletedById { get; set; }
    public int UsefulCount { get; set; }
}
/// <summary>Marcação "útil" (uma por usuário e post; não vale no próprio post).</summary>
public class GuildReaction
{
    public long PostId { get; set; }
    [MaxLength(450)] public string UserId { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
public class GuildReport
{
    public long Id { get; set; }
    public long PostId { get; set; }
    [MaxLength(450)] public string ReporterId { get; set; } = "";
    [MaxLength(500)] public string Reason { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ResolvedAt { get; set; }
    [MaxLength(450)] public string? ResolvedById { get; set; }
    /// <summary>dismissed | removed</summary>
    [MaxLength(20)] public string? Resolution { get; set; }
}

// ---------- Progressão ----------
/// <summary>Lançamento de XP idempotente: <see cref="SourceKey"/> é único (ex.: session:{id}:{user}).</summary>
public class XpEntry
{
    public long Id { get; set; }
    [MaxLength(450)] public string UserId { get; set; } = "";
    [MaxLength(40)] public string Reason { get; set; } = "";
    public int Amount { get; set; }
    [MaxLength(160)] public string SourceKey { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
public class UserAchievement
{
    [MaxLength(450)] public string UserId { get; set; } = "";
    [MaxLength(40)] public string Key { get; set; } = "";
    public DateTime UnlockedAt { get; set; } = DateTime.UtcNow;
}
