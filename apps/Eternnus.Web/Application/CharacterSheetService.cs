using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

/// <summary>Atributo disponível em fórmulas: nome usado com @ e rótulo exibido.</summary>
public sealed record FormulaField(string Name, string Label);

/// <summary>Gravação da ficha baseada em modelo: valores por nome de campo (calculados nunca vêm do cliente).
/// Envio parcial: somente os campos presentes mudam. <see cref="Actions"/> nulo preserva as ações do jogador.</summary>
public record CharacterSheetInput(Dictionary<string, JsonElement>? Values, List<CharacterAction>? Actions, int Revision, bool? Private = null);
public record CharacterMigrationInput(Guid TargetVersionId, int Revision);

/// <summary>Estado carregado de uma ficha: versão do modelo (fixada na ficha), modelo e valores gravados completos.
/// <see cref="Legacy"/>: ficha antiga (só colunas clássicas), lida como o modelo do Sistema livre v1 sem persistir.</summary>
public sealed record SheetContext(SheetTemplate Template, SheetTemplateVersion Version, Dictionary<string, string> Stored, bool Legacy)
{
    public bool IsFree => Template.Id == SheetTemplate.FreeTemplateId;
}

/// <summary>Item da prévia de migração: valor antigo e novo de um campo, com tipos de origem e destino.</summary>
public sealed record MigrationItem(string Name, string Label, string? FromType, string? ToType, string? OldValue, string? NewValue, string? Reason);

/// <summary>Plano de migração entre versões do mesmo modelo (campos casados pelo NOME).</summary>
public sealed record MigrationPlan(
    SheetTemplateVersion From, SheetTemplateVersion To, Dictionary<string, string> Values,
    List<MigrationItem> Kept, List<MigrationItem> Added, List<MigrationItem> Removed, List<MigrationItem> Changed, List<string> Warnings);

/// <summary>Rolagem de ação na linguagem de fórmulas, no formato que a mesa já desenha (formula, values, modifier, total) mais o detalhamento.</summary>
public sealed record ActionRoll(string Formula, int[] Values, int Modifier, double Total, string Breakdown, IReadOnlyList<DiceGroup> Dice);

public static class FieldChangeSources
{
    public const string Edit = "edit", Migration = "migration", Table = "table", Master = "master";
}

/// <summary>Regras da ficha do jogador compartilhadas entre <see cref="CharacterSheetService"/> e <see cref="SessionService"/>:
/// conversão da ficha antiga, validação por tipo, cálculo, espelho dos papéis nas colunas clássicas e histórico por campo.</summary>
public static class CharacterSheets
{
    public static async Task RequireCampaignSystemAsync(GameDb db, Character character, Campaign campaign, CancellationToken ct)
    {
        var origin = character.TemplateVersionId == null ? null : await db.SheetTemplateVersions
            .Where(v => v.Id == character.TemplateVersionId).Join(db.SheetTemplates, v => v.TemplateId, t => t.Id, (v, t) => new { t.RpgSystemId, t.CampaignId }).SingleAsync(ct);
        if (origin?.CampaignId is { } privateOf && privateOf != campaign.Id) throw new RuleException(400, "Esta ficha usa o modelo privado de outra campanha. Crie uma ficha com o modelo desta campanha.");
        var systemId = origin?.RpgSystemId ?? RpgSystem.FreeSystemId;
        if (systemId == campaign.RpgSystemId) return;
        if (systemId == RpgSystem.FreeSystemId && campaign.SheetTemplateId == null &&
            !await db.SheetTemplates.AnyAsync(t => t.RpgSystemId == campaign.RpgSystemId && t.IsDefault && t.ArchivedAt == null && t.CurrentVersionId != null, ct)) return;
        throw new RuleException(400, "Escolha uma ficha do sistema da campanha.");
    }

    static IQueryable<Campaign> OpenCampaigns(GameDb db)
    {
        var now = DateTime.UtcNow; var absent = now - OneShotLifecycleService.MasterAbsence;
        return db.Campaigns.Where(p => !p.IsOneShot || ((p.ExpiresAt == null || p.ExpiresAt > now) && (p.MasterLastSeenAt == null || p.MasterLastSeenAt > absent)));
    }

    public static Task<bool> IsMasterAsync(GameDb db, Guid id, string user, CancellationToken ct)
    {
        var campaigns = OpenCampaigns(db);
        return db.CampaignCharacters.AnyAsync(l => l.CharacterId == id && campaigns.Any(c => c.Id == l.CampaignId && c.OwnerId == user), ct);
    }

    public static IQueryable<Character> Editable(GameDb db, string user)
    {
        var campaigns = OpenCampaigns(db);
        return db.Characters.Where(c => c.OwnerId == user || db.CampaignCharacters.Any(l => l.CharacterId == c.Id && campaigns.Any(p => p.Id == l.CampaignId && p.OwnerId == user)));
    }

    public static IQueryable<Character> Readable(GameDb db, string user)
    {
        var campaigns = OpenCampaigns(db);
        return db.Characters.Where(c => c.OwnerId == user || db.CampaignCharacters.Any(l => l.CharacterId == c.Id && campaigns.Any(p => p.Id == l.CampaignId &&
            (p.OwnerId == user || (!c.Private && db.Members.Any(m => m.CampaignId == p.Id && m.UserId == user))))));
    }
    public const int MaxValuesJson = 100000, HistoryValueLength = 2000;
    static readonly Regex FieldName = new("^[a-z][a-z0-9_]{0,39}$", RegexOptions.CultureInvariant);

    /// <summary>Limites das colunas clássicas (os mesmos da ficha antiga) aplicados aos campos com papel.</summary>
    static readonly Dictionary<string, (int Min, int Max)> RoleLimits = new(StringComparer.Ordinal)
    {
        [SheetFieldRoles.Level] = (1, 1000),
        [SheetFieldRoles.Hp] = (0, 100000),
        [SheetFieldRoles.MaxHp] = (1, 100000),
        [SheetFieldRoles.Movement] = (0, 300),
        [SheetFieldRoles.Armor] = (0, 1000),
        [SheetFieldRoles.Light] = (0, 300),
        [SheetFieldRoles.Vision] = (0, 300),
        [SheetFieldRoles.Perception] = (-100, 1000),
        [SheetFieldRoles.Reach] = (0, 300),
    };

    /// <summary>Contrato coluna clássica ↔ campo do modelo do Sistema livre (<see cref="SheetTemplateService.FreeTemplateFields"/>).</summary>
    public static IReadOnlyList<(string Field, Func<Character, string> Read, Action<Character, string> Write)> FreeColumns { get; } =
    [
        ("nome", c => c.Name, (c, v) => { if (v.Trim().Length > 0) c.Name = Clip(v.Trim(), 100); }),
        ("nivel", c => Num(c.Level), (c, v) => c.Level = Int(v, 1, 1000, c.Level)),
        ("arquetipo", c => c.Archetype, (c, v) => c.Archetype = Clip(v, 80)),
        ("deslocamento", c => Num(c.Movement), (c, v) => c.Movement = Int(v, 0, 300, c.Movement)),
        ("vida", c => Num(c.Hp), (c, v) => c.Hp = Int(v, 0, 100000, c.Hp)),
        ("vida_max", c => Num(c.MaxHp), (c, v) => c.MaxHp = Int(v, 1, 100000, c.MaxHp)),
        ("armadura", c => Num(c.Armor), (c, v) => c.Armor = Int(v, 0, 1000, c.Armor)),
        ("forca", c => Num(c.Strength), (c, v) => c.Strength = Int(v, 0, 1000, c.Strength)),
        ("agilidade", c => Num(c.Agility), (c, v) => c.Agility = Int(v, 0, 1000, c.Agility)),
        ("intelecto", c => Num(c.Intellect), (c, v) => c.Intellect = Int(v, 0, 1000, c.Intellect)),
        ("constituicao", c => Num(c.Constitution), (c, v) => c.Constitution = Int(v, 0, 1000, c.Constitution)),
        ("notas", c => c.Notes, (c, v) => c.Notes = Clip(v, 10000)),
    ];

    static string Num(int value) => value.ToString(CultureInfo.InvariantCulture);
    static string Clip(string value, int max) => value.Length > max ? value[..max] : value;
    static int Int(string value, int min, int max, int fallback) =>
        SheetCalculator.ParseNumber(value) is double d ? (int)Math.Clamp(Formula.RoundHalfAwayFromZero(d), min, max) : fallback;

    public static bool IsFieldName(string? name) => name != null && FieldName.IsMatch(name);

    /// <summary>Valores JSON do cliente → texto: texto como está, número pelo literal, booleano "true"/"false", nulo vazio. Objetos e listas: 400.</summary>
    public static Dictionary<string, string?>? FromJson(Dictionary<string, JsonElement>? values)
    {
        if (values == null) return null;
        var result = new Dictionary<string, string?>(StringComparer.Ordinal);
        foreach (var (name, v) in values)
            result[name] = v.ValueKind switch
            {
                JsonValueKind.String => v.GetString(),
                JsonValueKind.Number => v.GetRawText(),
                JsonValueKind.True => "true",
                JsonValueKind.False => "false",
                JsonValueKind.Null or JsonValueKind.Undefined => "",
                _ => throw new RuleException(400, "Valor inválido na ficha."),
            };
        return result;
    }

    public static Dictionary<string, string> ParseValues(string? json)
    {
        var result = new Dictionary<string, string>(StringComparer.Ordinal);
        if (string.IsNullOrWhiteSpace(json)) return result;
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind != JsonValueKind.Object) return result;
            foreach (var p in doc.RootElement.EnumerateObject())
                result[p.Name] = p.Value.ValueKind switch
                {
                    JsonValueKind.String => p.Value.GetString() ?? "",
                    JsonValueKind.Number => p.Value.GetRawText(),
                    JsonValueKind.True => "true",
                    JsonValueKind.False => "false",
                    _ => "",
                };
        }
        catch (JsonException) { }
        return result;
    }

    /// <summary>Valores da ficha antiga mapeados para os nomes do modelo livre.</summary>
    public static Dictionary<string, string> LegacyValues(Character c) =>
        FreeColumns.ToDictionary(x => x.Field, x => x.Read(c), StringComparer.Ordinal);

    /// <summary>Valores completos: editáveis normalizados (com padrões) e calculados, separados.</summary>
    public static (Dictionary<string, string> Stored, Dictionary<string, string> Computed) Complete(IReadOnlyList<SheetField> fields, IReadOnlyDictionary<string, string> raw)
    {
        var all = SheetCalculator.Compute(fields, raw);
        var computedNames = fields.Where(f => f.Type == SheetFieldTypes.Computed).Select(f => f.Name).ToHashSet(StringComparer.Ordinal);
        var stored = new Dictionary<string, string>(StringComparer.Ordinal);
        var computed = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var (k, v) in all) (computedNames.Contains(k) ? computed : stored)[k] = v;
        return (stored, computed);
    }

    public static Dictionary<string, string> All(IReadOnlyList<SheetField> fields, IReadOnlyDictionary<string, string> stored) =>
        new(SheetCalculator.Compute(fields, stored), StringComparer.Ordinal);

    /// <summary>Carrega a versão fixada na ficha (ou o modelo livre v1 para a ficha antiga) e os valores completos. Nada é persistido.</summary>
    public static async Task<SheetContext> LoadAsync(GameDb db, Character c, CancellationToken ct)
    {
        var versionId = c.TemplateVersionId ?? SheetTemplateVersion.FreeTemplateV1Id;
        var version = await db.SheetTemplateVersions.AsNoTracking().SingleOrDefaultAsync(v => v.Id == versionId, ct);
        if (version == null && versionId == SheetTemplateVersion.FreeTemplateV1Id)
        {
            // A inicialização cria o modelo livre; bancos montados sem ela (testes) recebem-no aqui, uma única vez.
            await SheetTemplateService.EnsureFreeTemplateAsync(db, ct);
            version = await db.SheetTemplateVersions.AsNoTracking().SingleOrDefaultAsync(v => v.Id == versionId, ct);
        }
        if (version == null) throw new RuleException(503, "O modelo desta ficha não está disponível no momento.");
        var template = await db.SheetTemplates.AsNoTracking().SingleAsync(t => t.Id == version.TemplateId, ct);
        var legacy = c.TemplateVersionId == null;
        var raw = legacy ? LegacyValues(c) : ParseValues(c.Values);
        return new(template, version, Complete(version.Fields, raw).Stored, legacy);
    }

    /// <summary>Valida um valor vindo do cliente pelo tipo do campo e devolve o texto normalizado. Lança 400 com mensagem pt-BR.</summary>
    public static string ValidateValue(SheetField f, string? input)
    {
        var label = string.IsNullOrWhiteSpace(f.Label) ? f.Name : f.Label;
        var raw = (input ?? "").Replace("\0", "");
        switch (f.Type)
        {
            case SheetFieldTypes.Number:
            {
                var text = raw.Trim();
                if (text.Length == 0)
                {
                    if (f.Role != null) throw new RuleException(400, $"{label}: informe um número.");
                    return "";
                }
                if (SheetCalculator.ParseNumber(text) is not double value) throw new RuleException(400, $"{label}: informe um número válido.");
                double? min = f.Min, max = f.Max;
                if (f.Role != null && RoleLimits.TryGetValue(f.Role, out var limit))
                {
                    if (value != Math.Floor(value)) throw new RuleException(400, $"{label}: use um número inteiro.");
                    min = Math.Max(min ?? limit.Min, limit.Min); max = Math.Min(max ?? limit.Max, limit.Max);
                }
                if ((min is double lo && value < lo) || (max is double hi && value > hi))
                    throw new RuleException(400, $"{label}: use um valor {Range(min, max)}.");
                return Formula.Format(value);
            }
            case SheetFieldTypes.Checkbox:
                return raw.Trim() switch
                {
                    "true" => "true",
                    "false" or "" => "false",
                    _ => throw new RuleException(400, $"{label}: use verdadeiro ou falso."),
                };
            case SheetFieldTypes.Select:
            {
                var wanted = raw.Trim();
                if (wanted.Length == 0) return "";
                if (!(f.Options ?? []).Any(o => o != null && o.Trim() == wanted)) throw new RuleException(400, $"{label}: escolha uma das opções.");
                return wanted;
            }
            case SheetFieldTypes.Computed:
                return "";
            default:
            {
                var limit = TextLimit(f);
                if (f.Role == SheetFieldRoles.Name)
                {
                    raw = raw.Trim();
                    if (raw.Length == 0) throw new RuleException(400, $"{label}: informe o nome do personagem.");
                    limit = Math.Min(limit, 100);
                }
                if (raw.Length > limit) throw new RuleException(400, $"{label}: use até {limit} caracteres.");
                return raw;
            }
        }
    }

    static string Range(double? min, double? max) => (min, max) switch
    {
        (double a, double b) => $"entre {Formula.Format(a)} e {Formula.Format(b)}",
        (double a, null) => $"a partir de {Formula.Format(a)}",
        (null, double b) => $"até {Formula.Format(b)}",
        _ => "válido",
    };

    /// <summary>Mesmo teto de texto do <see cref="SheetCalculator"/>: textarea até 10.000; texto até 2.000 (padrão 200).</summary>
    public static int TextLimit(SheetField f)
    {
        var area = f.Type == SheetFieldTypes.TextArea;
        var cap = area ? SheetCalculator.MaxTextAreaLength : SheetCalculator.MaxTextLength;
        if (f.MaxLength is int m && m >= 1) return Math.Min(m, cap);
        return area ? SheetCalculator.MaxTextAreaLength : SheetCalculator.DefaultTextLength;
    }

    /// <summary>Aplica valores do cliente sobre os gravados. Campos calculados e nomes desconhecidos são ignorados.</summary>
    public static Dictionary<string, string> ApplyInput(SheetContext ctx, IReadOnlyDictionary<string, string?>? input)
    {
        var stored = new Dictionary<string, string>(ctx.Stored, StringComparer.Ordinal);
        if (input == null) return stored;
        if (input.Count > SheetTemplateLimits.MaxFields + 50) throw new RuleException(400, "Valores demais para esta ficha.");
        var byName = ctx.Version.Fields.GroupBy(f => f.Name).ToDictionary(g => g.Key, g => g.First(), StringComparer.Ordinal);
        foreach (var (name, value) in input)
        {
            if (!byName.TryGetValue(name ?? "", out var field) || field.Type == SheetFieldTypes.Computed) continue;
            stored[field.Name] = ValidateValue(field, value);
        }
        return stored;
    }

    /// <summary>Vida sempre entre 0 e a vida máxima: o campo de vida editável é limitado pelo valor (editável ou calculado) da vida máxima.</summary>
    public static Dictionary<string, string> ClampHp(IReadOnlyList<SheetField> fields, Dictionary<string, string> stored)
    {
        var hp = fields.FirstOrDefault(f => f.Role == SheetFieldRoles.Hp && f.Type == SheetFieldTypes.Number);
        var maxHp = fields.FirstOrDefault(f => f.Role == SheetFieldRoles.MaxHp);
        if (hp == null || maxHp == null) return stored;
        var all = All(fields, stored);
        if (SheetCalculator.ParseNumber(all.GetValueOrDefault(hp.Name)) is double h && SheetCalculator.ParseNumber(all.GetValueOrDefault(maxHp.Name)) is double m)
        {
            var clamped = Math.Clamp(h, 0, Math.Max(0, m));
            if (clamped != h) stored[hp.Name] = Formula.Format(Math.Floor(clamped));
        }
        return stored;
    }

    /// <summary>Copia os campos com papel (e, no modelo livre, todo o contrato de colunas) para as colunas clássicas lidas pela mesa e pelas listas.</summary>
    public static void Mirror(Character c, SheetContext ctx, IReadOnlyDictionary<string, string> all)
    {
        if (ctx.IsFree)
        {
            var names = ctx.Version.Fields.Select(f => f.Name).ToHashSet(StringComparer.Ordinal);
            foreach (var (field, _, write) in FreeColumns)
                if (names.Contains(field) && all.TryGetValue(field, out var v)) write(c, v);
        }
        foreach (var f in ctx.Version.Fields.Where(f => f.Role != null))
        {
            if (!all.TryGetValue(f.Name, out var v)) continue;
            switch (f.Role)
            {
                case SheetFieldRoles.Name: if (v.Trim().Length > 0) c.Name = Clip(v.Trim(), 100); break;
                case SheetFieldRoles.Level: c.Level = Int(v, 1, 1000, c.Level); break;
                case SheetFieldRoles.MaxHp: c.MaxHp = Int(v, 1, 100000, c.MaxHp); break;
                case SheetFieldRoles.Hp: c.Hp = Int(v, 0, 100000, c.Hp); break;
                case SheetFieldRoles.Movement: c.Movement = Int(v, 0, 300, c.Movement); break;
                case SheetFieldRoles.Armor: c.Armor = Int(v, 0, 1000, c.Armor); break;
                case SheetFieldRoles.Light: c.LightMeters = Int(v, 0, 300, c.LightMeters ?? 0); break;
                case SheetFieldRoles.Vision: c.VisionMeters = Int(v, 0, 300, c.VisionMeters ?? 0); break;
                case SheetFieldRoles.Perception: c.Perception = Int(v, -100, 1000, c.Perception ?? 0); break;
                case SheetFieldRoles.Senses: c.Senses = Clip(v.Trim(), 400); break;
                case SheetFieldRoles.Reach: c.ReachMeters = Int(v, 0, 300, c.ReachMeters ?? 0); break;
            }
        }
        // Sem o papel no modelo, a mesa usa a configuração (luz/visão) ou nenhum valor.
        var roles = ctx.Version.Fields.Select(f => f.Role).ToHashSet();
        if (!roles.Contains(SheetFieldRoles.Light)) c.LightMeters = null;
        if (!roles.Contains(SheetFieldRoles.Vision)) c.VisionMeters = null;
        if (!roles.Contains(SheetFieldRoles.Perception)) c.Perception = null;
        if (!roles.Contains(SheetFieldRoles.Senses)) c.Senses = null;
        if (!roles.Contains(SheetFieldRoles.Reach)) c.ReachMeters = null;
        c.Hp = Math.Clamp(c.Hp, 0, c.MaxHp);
    }

    /// <summary>Colunas clássicas → valores (PUT antigo e ajuste do mestre): no modelo livre todo o contrato; nos demais, só os campos editáveis com papel.</summary>
    public static Dictionary<string, string> FromColumns(Character c, SheetContext ctx)
    {
        var stored = new Dictionary<string, string>(ctx.Stored, StringComparer.Ordinal);
        var editable = ctx.Version.Fields.Where(f => f.Type != SheetFieldTypes.Computed).ToDictionary(f => f.Name, StringComparer.Ordinal);
        if (ctx.IsFree)
            foreach (var (field, read, _) in FreeColumns)
                if (editable.ContainsKey(field)) stored[field] = read(c);
        foreach (var f in editable.Values.Where(f => f.Role != null))
        {
            var value = RoleColumn(c, f.Role!);
            if (value != null) stored[f.Name] = value;
        }
        return Complete(ctx.Version.Fields, stored).Stored;
    }

    /// <summary>Valor da coluna clássica correspondente a um papel.</summary>
    public static string? RoleColumn(Character c, string role) => role switch
    {
        SheetFieldRoles.Name => c.Name,
        SheetFieldRoles.Level => Num(c.Level),
        SheetFieldRoles.Hp => Num(c.Hp),
        SheetFieldRoles.MaxHp => Num(c.MaxHp),
        SheetFieldRoles.Movement => Num(c.Movement),
        SheetFieldRoles.Armor => Num(c.Armor),
        SheetFieldRoles.Light => c.LightMeters is { } l ? Num(l) : null,
        SheetFieldRoles.Vision => c.VisionMeters is { } v ? Num(v) : null,
        SheetFieldRoles.Perception => c.Perception is { } p ? Num(p) : null,
        SheetFieldRoles.Senses => c.Senses,
        SheetFieldRoles.Reach => c.ReachMeters is { } r ? Num(r) : null,
        _ => null,
    };

    /// <summary>Sessão ativa de uma campanha à qual a ficha está vinculada (para o histórico por campo).</summary>
    public static Task<Guid?> ActiveSessionIdAsync(GameDb db, Guid characterId, CancellationToken ct) =>
        db.CampaignCharacters.Where(l => l.CharacterId == characterId)
            .Join(db.Sessions.Where(s => s.EndedAt == null), l => l.CampaignId, s => s.CampaignId, (l, s) => s)
            .OrderBy(s => s.StartedAt).Select(s => (Guid?)s.Id).FirstOrDefaultAsync(ct);

    /// <summary>Grava os novos valores na ficha: fixa a versão, espelha os papéis nas colunas e registra o histórico por campo.
    /// Não salva nem incrementa a revisão (o chamador decide). Devolve as mudanças com rótulo.</summary>
    public static List<SheetChange> Commit(GameDb db, Character c, SheetContext ctx, Dictionary<string, string> stored, string user, string source, Guid? sessionId, DateTime now)
    {
        stored = ClampHp(ctx.Version.Fields, Complete(ctx.Version.Fields, stored).Stored);
        var all = All(ctx.Version.Fields, stored);
        var json = JsonSerializer.Serialize(stored);
        if (json.Length > MaxValuesJson) throw new RuleException(400, "A ficha ficou grande demais. Reduza os textos.");
        c.Values = json;
        c.TemplateVersionId = ctx.Version.Id;
        Mirror(c, ctx, all);
        AddHistory(db, c.Id, ctx.Stored, stored, user, source, sessionId, ctx.Version.Id, now);
        return TableRules.DiffValues(ctx.Version.Fields, ctx.Stored, stored);
    }

    public static void AddHistory(GameDb db, Guid characterId, IReadOnlyDictionary<string, string> before, IReadOnlyDictionary<string, string> after,
        string user, string source, Guid? sessionId, Guid versionId, DateTime now)
    {
        foreach (var name in before.Keys.Union(after.Keys).Distinct().OrderBy(n => n, StringComparer.Ordinal))
        {
            var a = before.GetValueOrDefault(name) ?? ""; var b = after.GetValueOrDefault(name) ?? "";
            if (a == b) continue;
            db.FieldChanges.Add(new CharacterFieldChange
            {
                CharacterId = characterId, Field = name, OldValue = Clip(a, HistoryValueLength), NewValue = Clip(b, HistoryValueLength),
                ChangedById = user, SessionId = sessionId, TemplateVersionId = versionId, Source = source, CreatedAt = now,
            });
        }
    }

    /// <summary>Nomes numéricos (@nome) aceitos nas fórmulas das ações.</summary>
    public static IReadOnlySet<string> NumericNames(SheetTemplateVersion v) => SheetTemplateService.NumericNames(v.Fields);

    /// <summary>Atributos que uma fórmula aceita como @nome (campos numéricos e calculados), com o rótulo para o autocompletar.</summary>
    public static IEnumerable<FormulaField> FormulaFields(IEnumerable<SheetField> fields) =>
        fields.Where(f => f.Type is SheetFieldTypes.Number or SheetFieldTypes.Computed).Select(f => new FormulaField(f.Name, string.IsNullOrWhiteSpace(f.Label) ? f.Name : f.Label));

    /// <summary>Ações da versão do modelo (identificador "t:chave") seguidas das ações do jogador.</summary>
    public static List<object> CombinedActions(SheetTemplateVersion v, IEnumerable<CharacterAction>? own) =>
        v.Actions.Select(a => (object)new { id = TableRules.TemplateActionPrefix + a.Key, a.Name, a.Kind, a.Formula, a.Description, a.Group, source = "template" })
            .Concat((own ?? []).Select(a => (object)new { a.Id, a.Name, a.Kind, a.Formula, a.Description, a.Group, source = "player" })).ToList();

    /// <summary>Rola a fórmula de uma ação: formato antigo pelo <see cref="Dice"/>; demais pela linguagem de fórmulas com o escopo da ficha.</summary>
    public static object Roll(string formula, IReadOnlyDictionary<string, double> scope)
    {
        if (TableRules.IsLegacyFormula(formula)) return Dice.Roll(formula);
        try
        {
            var r = Formula.Roll(formula, scope);
            var kept = r.Dice.SelectMany(g => g.Kept.Select(i => g.Values[i])).ToArray();
            var modifier = (int)Formula.RoundHalfAwayFromZero(r.Total - r.Dice.Sum(g => g.Subtotal));
            return new ActionRoll(r.Formula, kept, modifier, r.Total, r.Breakdown, r.Dice);
        }
        catch (FormulaException e) { throw new RuleException(400, e.Message); }
    }

    public static string RollTotal(object roll) => roll switch
    {
        DiceResult d => $"{d.Formula} = {d.Total}",
        ActionRoll a => $"{a.Formula} = {Formula.Format(a.Total)}",
        _ => "",
    };

    /// <summary>Visão da ficha (modelo + valores + calculados + ações) para o dono e para o mestre na mesa.</summary>
    public static async Task<object> ViewAsync(GameDb db, Character c, SheetContext ctx, CancellationToken ct, string? user = null)
    {
        var (stored, computed) = Complete(ctx.Version.Fields, ctx.Stored);
        var current = ctx.Template.CurrentVersionId is { } cid && cid != ctx.Version.Id
            ? await db.SheetTemplateVersions.AsNoTracking().Where(v => v.Id == cid && v.PublishedAt != null && v.Number > ctx.Version.Number)
                .Select(v => new { v.Id, v.Number }).SingleOrDefaultAsync(ct)
            : null;
        var v = ctx.Version;
        return new
        {
            c.Id,
            c.Revision,
            c.Private,
            canEdit = user != null && (c.OwnerId == user || await IsMasterAsync(db, c.Id, user, ct)),
            canChangeVisibility = c.OwnerId == user,
            legacy = ctx.Legacy,
            template = new { ctx.Template.Id, ctx.Template.Name, systemId = ctx.Template.RpgSystemId, archived = ctx.Template.ArchivedAt != null, isDefault = ctx.Template.IsDefault && ctx.Template.CampaignId == null },
            version = new
            {
                v.Id, v.Number, v.Pages, v.Fields, v.Actions, hasPdf = v.PdfFileId != null,
                pdfUrl = v.PdfFileId != null ? $"/api/sheet-templates/{v.TemplateId}/versions/{v.Id}/pdf" : null,
            },
            values = stored,
            computed,
            actions = CombinedActions(v, c.Actions),
            newerVersion = current,
        };
    }
}

/// <summary>Casos de uso da ficha do jogador baseada em ficha-modelo. Toda leitura/escrita confere o dono no banco;
/// mudanças com sessão ativa entram na linha do tempo da sessão por <see cref="SessionService.WriteCharacterAsync"/>.</summary>
public class CharacterSheetService(GameDb db, SessionService sessions, ProgressionService progression, TimeProvider clock)
{
    public const int PageSize = 20;
    DateTime Now => clock.GetUtcNow().UtcDateTime;
    static RuleException NotFound() => new(404, "Ficha não encontrada.");
    static RuleException Stale() => new(409, "A ficha mudou em outra janela. Feche e abra novamente antes de editar.");
    static void Snapshot(GameDb db, Character c, DateTime now) => db.Versions.Add(new() { CharacterId = c.Id, Revision = c.Revision, Snapshot = JsonSerializer.Serialize(c), ChangedById = c.OwnerId, CreatedAt = now });

    static bool Text(string? value, int max, bool required = false) => value != null && value.Length <= max && (!required || !string.IsNullOrWhiteSpace(value));
    /// <summary>Validação da ficha clássica (clientes antigos).</summary>
    public static bool ValidClassic(CharacterInput x) => Text(x.Name, 100, true) && Text(x.Archetype, 80) && Text(x.Notes, 10000) && x.Level is >= 1 and <= 1000 && x.MaxHp is >= 1 and <= 100000
        && x.Hp >= 0 && x.Hp <= x.MaxHp && x.Strength is >= 0 and <= 1000 && x.Agility is >= 0 and <= 1000 && x.Intellect is >= 0 and <= 1000
        && x.Constitution is >= 0 and <= 1000 && x.Armor is >= 0 and <= 1000 && x.Movement is >= 0 and <= 300;
    static void CopyClassic(CharacterInput x, Character c)
    {
        c.Name = x.Name.Trim(); c.Archetype = x.Archetype; c.Level = x.Level; c.Hp = x.Hp; c.MaxHp = x.MaxHp; c.Strength = x.Strength; c.Agility = x.Agility; c.Intellect = x.Intellect;
        c.Constitution = x.Constitution; c.Armor = x.Armor; c.Movement = x.Movement; c.Notes = x.Notes;
        // Clientes anteriores não enviam ações: preservar a lista existente em vez de apagá-la.
        if (x.Actions != null) c.Actions = x.Actions;
    }

    async Task<Character> OwnedAsync(Guid id, string user, CancellationToken ct) =>
        await CharacterSheets.Editable(db, user).SingleOrDefaultAsync(c => c.Id == id, ct) ?? throw NotFound();

    // ---------------- Modelo de origem ----------------

    /// <summary>Modelo usado por uma campanha: escolhido pelo mestre (se publicado, ativo e do sistema), senão o padrão do sistema, senão o do Sistema livre.</summary>
    async Task<(SheetTemplate Template, SheetTemplateVersion Version, string Source)> CampaignTemplateAsync(Campaign campaign, CancellationToken ct)
    {
        if (campaign.SheetTemplateId is { } chosen)
        {
            var t = await db.SheetTemplates.AsNoTracking().SingleOrDefaultAsync(x => x.Id == chosen && x.RpgSystemId == campaign.RpgSystemId && x.ArchivedAt == null && x.CurrentVersionId != null && (x.CampaignId == null || x.CampaignId == campaign.Id), ct);
            if (t != null) return (t, await VersionAsync(t.CurrentVersionId!.Value, ct), "campaign");
        }
        var d = await db.SheetTemplates.AsNoTracking().Where(x => x.RpgSystemId == campaign.RpgSystemId && x.IsDefault && x.ArchivedAt == null && x.CurrentVersionId != null && x.CampaignId == null)
            .OrderBy(x => x.CreatedAt).FirstOrDefaultAsync(ct);
        if (d != null) return (d, await VersionAsync(d.CurrentVersionId!.Value, ct), "default");
        var (ft, fv) = await FreeAsync(ct);
        return (ft, fv, "free");
    }

    async Task<(SheetTemplate, SheetTemplateVersion)> FreeAsync(CancellationToken ct)
    {
        var t = await db.SheetTemplates.AsNoTracking().SingleOrDefaultAsync(x => x.Id == SheetTemplate.FreeTemplateId, ct)
            ?? throw new RuleException(503, "O modelo do Sistema livre não está disponível no momento.");
        return (t, await VersionAsync(t.CurrentVersionId ?? SheetTemplateVersion.FreeTemplateV1Id, ct));
    }

    async Task<SheetTemplateVersion> VersionAsync(Guid id, CancellationToken ct) =>
        await db.SheetTemplateVersions.AsNoTracking().SingleOrDefaultAsync(v => v.Id == id && v.PublishedAt != null, ct)
        ?? throw new RuleException(503, "A versão do modelo não está disponível no momento.");

    async Task<(Campaign Campaign, bool IsMaster)> CampaignAccessAsync(Guid campaignId, string user, CancellationToken ct)
    {
        var c = await db.Campaigns.AsNoTracking().SingleOrDefaultAsync(x => x.Id == campaignId, ct) ?? throw new RuleException(404, "Campanha não encontrada.");
        if (c.OwnerId == user) return (c, true);
        if (!await db.Members.AnyAsync(m => m.CampaignId == campaignId && m.UserId == user, ct)) throw new RuleException(404, "Campanha não encontrada.");
        return (c, false);
    }

    /// <summary>GET /api/campaigns/{id}/sheet-template: o modelo com que as fichas desta campanha nascem.</summary>
    public async Task<object> CampaignSheetTemplateAsync(Guid campaignId, string user, CancellationToken ct)
    {
        var (campaign, _) = await CampaignAccessAsync(campaignId, user, ct);
        var (t, v, source) = await CampaignTemplateAsync(campaign, ct);
        var system = await db.RpgSystems.AsNoTracking().Where(s => s.Id == campaign.RpgSystemId).Select(s => new { s.Id, s.Name }).SingleOrDefaultAsync(ct);
        return new
        {
            campaignId,
            system,
            source,
            template = new { t.Id, t.Name, t.Description, isDefault = t.IsDefault && t.CampaignId == null },
            version = new { v.Id, v.Number, fields = v.Fields.Count, actions = v.Actions.Count, hasPdf = v.PdfFileId != null, pdfUrl = v.PdfFileId != null ? $"/api/sheet-templates/{t.Id}/versions/{v.Id}/pdf" : null },
        };
    }

    // ---------------- Criação ----------------

    /// <summary>POST /api/characters. Com <c>campaignId</c>/<c>templateId</c>/<c>values</c> a ficha nasce do modelo (da campanha, o indicado ou o livre);
    /// sem eles, aceita o formato clássico e nasce no modelo do Sistema livre.</summary>
    public async Task<Character> CreateAsync(CharacterInput x, string user, CancellationToken ct)
    {
        var modern = x.TemplateId != null || x.CampaignId != null || x.Values != null;
        var c = new Character { OwnerId = user, UpdatedAt = Now, Private = x.Private ?? false };
        SheetTemplate template; SheetTemplateVersion version; Campaign? campaign = null; var member = false;
        if (x.CampaignId is { } cid)
        {
            var (camp, master) = await CampaignAccessAsync(cid, user, ct);
            campaign = camp; member = !master;
            (template, version, _) = await CampaignTemplateAsync(camp, ct);
            if (x.TemplateId is { } wanted && wanted != template.Id)
            {
                var other = await db.SheetTemplates.AsNoTracking().SingleOrDefaultAsync(t => t.Id == wanted && t.ArchivedAt == null && t.CurrentVersionId != null && (t.CampaignId == null || t.CampaignId == cid), ct)
                    ?? throw new RuleException(404, "Ficha-modelo não encontrada.");
                if (other.RpgSystemId != camp.RpgSystemId) throw new RuleException(400, "Escolha uma ficha-modelo do sistema da campanha.");
                template = other; version = await VersionAsync(other.CurrentVersionId!.Value, ct);
            }
        }
        else if (x.TemplateId is { } tid)
        {
            template = await db.SheetTemplates.AsNoTracking().SingleOrDefaultAsync(t => t.Id == tid && t.ArchivedAt == null && t.CurrentVersionId != null && t.CampaignId == null, ct)
                ?? throw new RuleException(404, "Ficha-modelo não encontrada.");
            version = await VersionAsync(template.CurrentVersionId!.Value, ct);
        }
        else (template, version) = await FreeAsync(ct);

        var ctx = new SheetContext(template, version, CharacterSheets.Complete(version.Fields, new Dictionary<string, string>()).Stored, false);
        Dictionary<string, string> stored;
        if (!modern)
        {
            if (!ValidClassic(x)) throw new RuleException(400, "Confira os campos da ficha. Vida atual deve estar entre zero e vida máxima.");
            CopyClassic(x, c);
            stored = CharacterSheets.FromColumns(c, ctx);
        }
        else
        {
            var input = CharacterSheets.FromJson(x.Values) ?? new Dictionary<string, string?>(StringComparer.Ordinal);
            var nameField = version.Fields.FirstOrDefault(f => f.Role == SheetFieldRoles.Name && f.Type == SheetFieldTypes.Text);
            var name = (x.Name ?? "").Trim();
            if (name.Length > 100) throw new RuleException(400, "O nome aceita até 100 caracteres.");
            if (nameField != null && string.IsNullOrWhiteSpace(input.GetValueOrDefault(nameField.Name)) && name.Length > 0) input[nameField.Name] = name;
            stored = CharacterSheets.ApplyInput(ctx, input);
            if (nameField != null && string.IsNullOrWhiteSpace(stored.GetValueOrDefault(nameField.Name)))
                throw new RuleException(400, $"{nameField.Label}: informe o nome do personagem.");
            c.Name = name;
            if (x.Actions != null) c.Actions = x.Actions;
        }
        if (TableRules.ValidateActions(c.Actions, CharacterSheets.NumericNames(version)) is { } actionError) throw new RuleException(400, actionError);
        c.Values = "{}";
        // Criação não gera histórico por campo: o contexto "antes" é o próprio resultado.
        stored = CharacterSheets.ClampHp(version.Fields, CharacterSheets.Complete(version.Fields, stored).Stored);
        CharacterSheets.Commit(db, c, ctx with { Stored = stored }, stored, user, FieldChangeSources.Edit, null, Now);
        if (string.IsNullOrWhiteSpace(c.Name)) throw new RuleException(400, "Informe o nome do personagem.");
        db.Characters.Add(c);
        Snapshot(db, c, Now);
        if (campaign != null && member) db.CampaignCharacters.Add(new() { CampaignId = campaign.Id, CharacterId = c.Id });
        await progression.AwardAsync(c.OwnerId, XpReasons.CharacterCreated, $"{XpReasons.CharacterCreated}:{c.Id}", ct);
        await db.SaveChangesAsync(ct);
        return c;
    }

    // ---------------- Ficha clássica (clientes antigos) ----------------

    public async Task<List<Character>> ListAsync(string user, CancellationToken ct) =>
        await db.Characters.AsNoTracking().Where(c => c.OwnerId == user).OrderByDescending(c => c.UpdatedAt).ThenBy(c => c.Id).Take(200).ToListAsync(ct);

    /// <summary>PUT /api/characters/{id} (formato clássico): grava as colunas e mantém os valores do modelo coerentes
    /// (modelo livre: contrato completo; demais modelos: campos com papel), com histórico por campo.</summary>
    public Task<Character> UpdateClassicAsync(Guid id, CharacterInput x, string user, CancellationToken ct) =>
        sessions.WriteCharacterAsync(id, user, async (c, sessionId) =>
        {
            if (!ValidClassic(x)) throw new RuleException(400, "Confira os campos e os limites da ficha.");
            if (x.Revision != c.Revision) throw Stale();
            var ctx = await CharacterSheets.LoadAsync(db, c, ct);
            if (TableRules.ValidateActions(x.Actions, CharacterSheets.NumericNames(ctx.Version)) is { } error) throw new RuleException(400, error);
            var before = CharacterSnapshot.Of(c);
            var actionsBefore = JsonSerializer.Serialize(c.Actions);
            CopyClassic(x, c);
            var changes = CharacterSheets.Commit(db, c, ctx, CharacterSheets.FromColumns(c, ctx), user, c.OwnerId == user ? FieldChangeSources.Edit : FieldChangeSources.Master, sessionId, Now);
            foreach (var change in TableRules.Diff(before, CharacterSnapshot.Of(c)))
                if (!changes.Any(a => a.Field == change.Field)) changes.Add(change);
            AuditExtras(c, x.Private, actionsBefore, changes, user, sessionId);
            if (ctx.Legacy && changes.Count == 0) changes.Add(new("template", "Modelo", "Clássica", "Sistema livre"));
            return changes;
        }, ct);

    void AuditExtras(Character c, bool? privacy, string actionsBefore, List<SheetChange> changes, string user, Guid? sessionId)
    {
        var actionsAfter = JsonSerializer.Serialize(c.Actions);
        if (actionsBefore != actionsAfter)
        {
            CharacterSheets.AddHistory(db, c.Id, new Dictionary<string, string> { ["actions"] = actionsBefore },
                new Dictionary<string, string> { ["actions"] = actionsAfter }, user, c.OwnerId == user ? FieldChangeSources.Edit : FieldChangeSources.Master, sessionId, c.TemplateVersionId!.Value, Now);
            changes.Add(new("actions", "Ações", actionsBefore, actionsAfter));
        }
        if (privacy is bool value && value != c.Private)
        {
            if (c.OwnerId != user) throw new RuleException(403, "Somente o dono pode escolher a visibilidade da ficha.");
            CharacterSheets.AddHistory(db, c.Id, new Dictionary<string, string> { ["private"] = c.Private.ToString() },
                new Dictionary<string, string> { ["private"] = value.ToString() }, user, c.OwnerId == user ? FieldChangeSources.Edit : FieldChangeSources.Master, sessionId, c.TemplateVersionId!.Value, Now);
            changes.Add(new("private", "Visibilidade privada", c.Private.ToString(), value.ToString())); c.Private = value;
        }
    }

    // ---------------- Ficha por modelo ----------------

    public async Task<object> SheetAsync(Guid id, string user, CancellationToken ct)
    {
        var c = await CharacterSheets.Readable(db, user).AsNoTracking().SingleOrDefaultAsync(c => c.Id == id, ct) ?? throw NotFound();
        return await CharacterSheets.ViewAsync(db, c, await CharacterSheets.LoadAsync(db, c, ct), ct, user);
    }

    public async Task<object> UpdateSheetAsync(Guid id, CharacterSheetInput x, string user, CancellationToken ct)
    {
        var c = await sessions.WriteCharacterAsync(id, user, async (c, sessionId) =>
        {
            if (x.Revision != c.Revision) throw Stale();
            var ctx = await CharacterSheets.LoadAsync(db, c, ct);
            var stored = CharacterSheets.ApplyInput(ctx, CharacterSheets.FromJson(x.Values));
            if (x.Actions != null && TableRules.ValidateActions(x.Actions, CharacterSheets.NumericNames(ctx.Version)) is { } error) throw new RuleException(400, error);
            var actionsBefore = JsonSerializer.Serialize(c.Actions);
            var changes = CharacterSheets.Commit(db, c, ctx, stored, user, c.OwnerId == user ? FieldChangeSources.Edit : FieldChangeSources.Master, sessionId, Now);
            if (x.Actions != null) c.Actions = x.Actions;
            AuditExtras(c, x.Private, actionsBefore, changes, user, sessionId);
            if (ctx.Legacy && changes.Count == 0) changes.Add(new("template", "Modelo", "Clássica", "Sistema livre"));
            return changes;
        }, ct);
        return await CharacterSheets.ViewAsync(db, c, await CharacterSheets.LoadAsync(db, c, ct), ct, user);
    }

    public async Task<object> FieldHistoryAsync(Guid id, string? field, int page, string user, CancellationToken ct)
    {
        var c = await CharacterSheets.Editable(db, user).AsNoTracking().Where(c => c.Id == id).Select(c => new { c.Id, c.OwnerId, c.TemplateVersionId }).SingleOrDefaultAsync(ct) ?? throw NotFound();
        field = string.IsNullOrWhiteSpace(field) ? null : field.Trim();
        if (field != null && !CharacterSheets.IsFieldName(field)) throw new RuleException(400, "Campo inválido.");
        page = Math.Clamp(page, 1, 100000);
        var query = db.FieldChanges.AsNoTracking().Where(h => h.CharacterId == id && (field == null || h.Field == field));
        if (c.OwnerId != user) query = query.Where(h => db.Sessions.Any(s => s.Id == h.SessionId && db.Campaigns.Any(p => p.Id == s.CampaignId && p.OwnerId == user)));
        var total = await query.CountAsync(ct);
        var items = await query.OrderByDescending(h => h.Id).Skip((page - 1) * PageSize).Take(PageSize)
            .Select(h => new
            {
                h.Id, h.Field, h.OldValue, h.NewValue, h.Source, h.SessionId, h.ChangedById, h.TemplateVersionId, h.CreatedAt,
                changedBy = db.Users.Where(u => u.Id == h.ChangedById).Select(u => u.DisplayName).FirstOrDefault(),
                session = db.Sessions.Where(s => s.Id == h.SessionId).Select(s => new { s.Number, s.Title }).FirstOrDefault(),
            }).ToListAsync(ct);
        var versionId = c.TemplateVersionId ?? SheetTemplateVersion.FreeTemplateV1Id;
        var fields = await db.SheetTemplateVersions.AsNoTracking().Where(v => v.Id == versionId).Select(v => v.Fields).SingleOrDefaultAsync(ct) ?? [];
        var labels = fields.GroupBy(f => f.Name).ToDictionary(g => g.Key, g => g.First().Label, StringComparer.Ordinal);
        return new
        {
            items = items.Select(h => new { h.Id, h.Field, label = labels.GetValueOrDefault(h.Field) ?? h.Field, h.OldValue, h.NewValue, h.Source, h.SessionId, h.session, h.ChangedById, h.TemplateVersionId, h.CreatedAt, h.changedBy }),
            total, page, pageSize = PageSize,
        };
    }

    // ---------------- Migração de versão ----------------

    /// <summary>Plano puro: campos casados pelo NOME. Novos recebem o padrão (ou a coluna clássica, se tiverem papel); removidos saem;
    /// tipo diferente tenta aproveitar o valor e, se não couber, usa o padrão.</summary>
    public static MigrationPlan Plan(Character c, SheetContext ctx, SheetTemplateVersion target)
    {
        var source = ctx.Version.Fields.Where(f => f.Type != SheetFieldTypes.Computed).GroupBy(f => f.Name).ToDictionary(g => g.Key, g => g.First(), StringComparer.Ordinal);
        var editable = target.Fields.Where(f => f.Type != SheetFieldTypes.Computed).GroupBy(f => f.Name).Select(g => g.First()).ToList();
        var defaults = CharacterSheets.Complete(target.Fields, new Dictionary<string, string>()).Stored;
        var values = new Dictionary<string, string>(StringComparer.Ordinal);
        List<MigrationItem> kept = [], added = [], removed = [], changed = [];
        string Fallback(SheetField f)
        {
            if (f.Role != null && CharacterSheets.RoleColumn(c, f.Role) is { } column)
            {
                try { return CharacterSheets.ValidateValue(f, column); } catch (RuleException) { }
            }
            return defaults.GetValueOrDefault(f.Name) ?? "";
        }
        foreach (var f in editable)
        {
            var label = string.IsNullOrWhiteSpace(f.Label) ? f.Name : f.Label;
            if (source.TryGetValue(f.Name, out var old) && ctx.Stored.TryGetValue(f.Name, out var oldValue))
            {
                string value; string? reason = null;
                try { value = CharacterSheets.ValidateValue(f, oldValue); }
                catch (RuleException) { value = Fallback(f); reason = "reset"; }
                if (old.Type != f.Type) reason ??= "type";
                else if (value != oldValue) reason ??= "adjusted";
                values[f.Name] = value;
                var item = new MigrationItem(f.Name, label, old.Type, f.Type, oldValue, value, reason);
                (reason == null ? kept : changed).Add(item);
            }
            else
            {
                var value = Fallback(f);
                values[f.Name] = value;
                added.Add(new(f.Name, label, null, f.Type, null, value, null));
            }
        }
        var targetNames = editable.Select(f => f.Name).ToHashSet(StringComparer.Ordinal);
        foreach (var (name, value) in ctx.Stored)
        {
            if (targetNames.Contains(name)) continue;
            var f = source.GetValueOrDefault(name);
            var toType = target.Fields.FirstOrDefault(t => t.Name == name)?.Type;
            removed.Add(new(name, f?.Label ?? name, f?.Type, toType, value, null, toType == SheetFieldTypes.Computed ? "computed" : null));
        }
        values = CharacterSheets.ClampHp(target.Fields, CharacterSheets.Complete(target.Fields, values).Stored);
        var numeric = CharacterSheets.NumericNames(target);
        var warnings = (c.Actions ?? []).Where(a => a.Formula.Length > 0 && !TableRules.IsLegacyFormula(a.Formula) && !Formula.Validate(a.Formula, FormulaMode.Roll, numeric).Ok)
            .Select(a => $"A ação \"{a.Name}\" usa campos que não existem na nova versão; eles valerão 0 até você editar a fórmula.").ToList();
        return new(ctx.Version, target, values, kept, added, removed, changed, warnings);
    }

    async Task<(Character Character, SheetContext Ctx, SheetTemplateVersion Target)> MigrationTargetAsync(Guid id, string user, bool track, CancellationToken ct)
    {
        var c = track ? await OwnedAsync(id, user, ct)
            : await CharacterSheets.Editable(db, user).AsNoTracking().SingleOrDefaultAsync(c => c.Id == id, ct) ?? throw NotFound();
        var ctx = await CharacterSheets.LoadAsync(db, c, ct);
        var currentId = await db.SheetTemplates.AsNoTracking().Where(t => t.Id == ctx.Template.Id).Select(t => t.CurrentVersionId).SingleOrDefaultAsync(ct);
        var target = currentId is { } cid && cid != ctx.Version.Id
            ? await db.SheetTemplateVersions.AsNoTracking().SingleOrDefaultAsync(v => v.Id == cid && v.PublishedAt != null && v.Number > ctx.Version.Number, ct)
            : null;
        if (target == null) throw new RuleException(409, "A ficha já está na versão mais recente do modelo.");
        return (c, ctx, target);
    }

    static object PlanView(Character c, MigrationPlan p) => new
    {
        characterId = c.Id,
        c.Revision,
        from = new { p.From.Id, p.From.Number },
        to = new { p.To.Id, p.To.Number, hasPdf = p.To.PdfFileId != null },
        kept = p.Kept, added = p.Added, removed = p.Removed, changed = p.Changed, warnings = p.Warnings,
        values = p.Values,
        computed = CharacterSheets.Complete(p.To.Fields, p.Values).Computed,
    };

    public async Task<object> MigrationPreviewAsync(Guid id, string user, CancellationToken ct)
    {
        var (c, ctx, target) = await MigrationTargetAsync(id, user, false, ct);
        return PlanView(c, Plan(c, ctx, target));
    }

    /// <summary>Migra para a versão atual do modelo (a mesma da prévia). Valores removidos ficam no histórico (Source "migration").</summary>
    public async Task<object> MigrateAsync(Guid id, CharacterMigrationInput x, string user, CancellationToken ct)
    {
        MigrationPlan? plan = null;
        SheetContext? ctx = null;
        SheetTemplateVersion? target = null;
        var c = await sessions.WriteCharacterAsync(id, user, async (character, sessionId) =>
        {
            (_, ctx, target) = await MigrationTargetAsync(id, user, true, ct);
            if (x.Revision != character.Revision) throw Stale();
            if (x.TargetVersionId != target.Id) throw new RuleException(409, "O modelo publicou outra versão. Abra a prévia novamente.");
            plan = Plan(character, ctx, target);
            var changes = CharacterSheets.Commit(db, character, new SheetContext(ctx.Template, target, ctx.Stored, false), plan.Values,
                user, FieldChangeSources.Migration, sessionId, Now);
            CharacterSheets.AddHistory(db, id, new Dictionary<string, string> { ["template"] = ctx.Version.Id.ToString() },
                new Dictionary<string, string> { ["template"] = target.Id.ToString() }, user, FieldChangeSources.Migration, sessionId, target.Id, Now);
            changes.Insert(0, new SheetChange("template", "Versão do modelo", $"v{ctx.Version.Number}", $"v{target.Number}"));
            return changes;
        }, ct);
        return new
        {
            migrated = new { from = new { ctx!.Version.Id, ctx.Version.Number }, to = new { target!.Id, target.Number }, kept = plan!.Kept.Count, added = plan.Added.Count, removed = plan.Removed.Count, changed = plan.Changed.Count },
            sheet = await CharacterSheets.ViewAsync(db, c, await CharacterSheets.LoadAsync(db, c, ct), ct, user),
        };
    }
}
