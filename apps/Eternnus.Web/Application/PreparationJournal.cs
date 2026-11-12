using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

/// <summary>Diário, convites, início e modelos privados simples.</summary>
public sealed partial class PreparationService
{
    // ---------- Diário da campanha ----------
    /// <summary>Visão compartilhada: resumos publicados, objetivos/pistas publicados, próxima partida e presença. Notas privadas nunca entram.</summary>
    public async Task<object> JournalAsync(Guid campaignId, string user, CancellationToken ct, int page = 1, string? search = null)
    {
        page = Math.Clamp(page, 1, 100000);
        if (search?.Length > 100) throw new RuleException(400, "Busca aceita até 100 caracteres.");
        var (c, master) = await AccessAsync(campaignId, user, false, false, ct);
        var recapQuery = db.Sessions.AsNoTracking().Where(s => s.CampaignId == campaignId && (master ? s.Recap != "" : s.RecapPublishedAt != null));
        if (!string.IsNullOrWhiteSpace(search)) recapQuery = recapQuery.Where(TextSearch.AnyField<GameSession>(db, TextSearch.Pattern(search.Trim()), s => s.Title, s => s.Recap));
        var recapTotal = await recapQuery.CountAsync(ct);
        var recaps = await recapQuery.OrderByDescending(s => s.Number).Skip((page - 1) * 20).Take(20)
            .Select(s => new { s.Id, s.Number, s.Title, s.Recap, s.RecapPublishedAt, s.StartedAt, s.EndedAt, published = s.RecapPublishedAt != null }).ToListAsync(ct);
        // Objetivos e pistas são páginas do Mundo (ADR-063). Mesma regra de leitura das páginas: o mestre vê todas;
        // o jogador, as de "Toda a mesa" e as compartilhadas com ele. Segredos nunca entram.
        var entries = await db.Set<WorkspacePage>().AsNoTracking()
            .Where(p => p.CampaignId == campaignId && p.DeletedAt == null && (p.Kind == "objective" || p.Kind == "clue")
                && (master || p.OwnerId == user || p.Visibility == "table" || p.Visibility == "selected" && db.Set<WorkspaceReader>().Any(r => r.PageId == p.Id && r.UserId == user)))
            .OrderBy(p => p.Kind).ThenBy(p => p.Status != "open").ThenByDescending(p => p.Pinned).ThenByDescending(p => p.UpdatedAt).Take(100)
            .Select(p => new { p.Id, p.Kind, p.Title, text = p.Content, published = p.Visibility == "table", p.Visibility, p.Status, p.Revision, p.UpdatedAt }).ToListAsync(ct);
        var attendance = c.NextSessionAt is { } at
            ? await db.Attendance.AsNoTracking().Where(a => a.CampaignId == campaignId && a.SessionAt == at)
                .Join(db.Users, a => a.UserId, u => u.Id, (a, u) => new { a.UserId, name = u.DisplayName, a.Status }).OrderBy(a => a.name).ToListAsync(ct)
            : [];
        var members = await db.Members.CountAsync(m => m.CampaignId == campaignId, ct);
        return new
        {
            campaign = new { c.Id, c.Name, isMaster = master, archived = c.ArchivedAt != null },
            nextSession = c.NextSessionAt == null ? null : new { at = DateTime.SpecifyKind(c.NextSessionAt.Value, DateTimeKind.Utc), note = c.NextSessionNote },
            myAttendance = attendance.FirstOrDefault(a => a.UserId == user)?.Status,
            attendance = attendance.Select(a => new { a.name, a.Status, isMe = a.UserId == user }),
            pending = Math.Max(0, members - attendance.Count),
            recaps, entries, recapTotal, page, pageSize = 20,
        };
    }

    public async Task ScheduleAsync(Guid campaignId, ScheduleInput x, string user, CancellationToken ct)
    {
        await AccessAsync(campaignId, user, true, true, ct);
        var note = Text(x.Note, 200, "A observação aceita até 200 caracteres.");
        DateTime? at = x.At?.UtcDateTime;
        if (at is { } when && (when < Now.AddDays(-1) || when > Now.AddYears(2))) throw new RuleException(400, "Escolha uma data entre hoje e os próximos dois anos.");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await db.Campaigns.Where(c => c.Id == campaignId).ExecuteUpdateAsync(c => c.SetProperty(p => p.NextSessionAt, at).SetProperty(p => p.NextSessionNote, note), ct);
        // Data marcada pede confirmação de presença: novidade no Início e no Diário. Desmarcar apaga o aviso.
        if (at != null) await NoticeService.NotifyAsync(db, campaignId, user, NoticeAreas.Schedule, "schedule", NoticeAudience.Players, ct);
        else await NoticeService.ForgetAsync(db, campaignId, "schedule", ct);
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
    }

    public async Task AttendanceAsync(Guid campaignId, AttendanceInput x, string user, CancellationToken ct)
    {
        if (!AttendanceStatuses.IsValid(x.Status)) throw new RuleException(400, "Responda vou, talvez ou não vou.");
        var (c, master) = await AccessAsync(campaignId, user, false, true, ct);
        if (master) throw new RuleException(409, "O mestre marca a data; a confirmação é dos jogadores.");
        if (c.NextSessionAt is not { } at) throw new RuleException(409, "O mestre ainda não marcou a próxima partida.");
        var row = await db.Attendance.SingleOrDefaultAsync(a => a.CampaignId == campaignId && a.UserId == user, ct);
        if (row == null) db.Attendance.Add(row = new CampaignAttendance { CampaignId = campaignId, UserId = user });
        row.SessionAt = at; row.Status = x.Status; row.UpdatedAt = Now;
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException) { throw new RuleException(409, "Sua resposta mudou em outra tela. Recarregue e tente novamente."); }
    }

    // ---------- Convites ----------
    static readonly Regex InviteFormat = new("^[0-9a-f]{32}$", RegexOptions.Compiled);

    public async Task<object> InviteAsync(string code, string user, CancellationToken ct)
    {
        if (!InviteFormat.IsMatch(code ?? "")) throw new RuleException(400, "Código de convite inválido.");
        var c = await db.Campaigns.AsNoTracking().SingleOrDefaultAsync(x => x.InviteCode == code, ct) ?? throw new RuleException(404, "Convite não encontrado. Peça um novo link ao mestre.");
        var master = await db.Users.Where(u => u.Id == c.OwnerId).Select(u => u.DisplayName).SingleOrDefaultAsync(ct) ?? "Mestre";
        var member = c.OwnerId == user || await db.Members.AnyAsync(m => m.CampaignId == c.Id && m.UserId == user, ct);
        var online = await db.Sessions.AnyAsync(s => s.CampaignId == c.Id && s.EndedAt == null, ct);
        var settings = c.TableSettings != null ? TableSettings.Parse(c.TableSettings) : TableSettings.Parse(await db.RpgSystems.Where(s => s.Id == c.RpgSystemId).Select(s => s.TableSettings).SingleOrDefaultAsync(ct));
        return new
        {
            campaignId = c.Id, c.Name, c.System, master, c.IsOneShot, archived = c.ArchivedAt != null, expired = OneShotLifecycleService.Expired(c, Now),
            member, isMaster = c.OwnerId == user, online, playMode = settings.PlayMode, playModeLabel = PlayModes.Label(settings.PlayMode),
        };
    }

    /// <summary>Guarda o convite enquanto a conta confirma o e-mail. Não confere existência (sem oráculo) nem concede acesso.</summary>
    public async Task SetPendingInviteAsync(string? code, string user, CancellationToken ct)
    {
        if (code != null && !InviteFormat.IsMatch(code)) throw new RuleException(400, "Código de convite inválido.");
        await db.Users.Where(u => u.Id == user).ExecuteUpdateAsync(u => u.SetProperty(p => p.PendingInvite, code), ct);
    }

    public async Task<object> PendingInviteAsync(string user, CancellationToken ct) =>
        new { code = await db.Users.Where(u => u.Id == user).Select(u => u.PendingInvite).SingleOrDefaultAsync(ct) };

    // ---------- Início ----------
    /// <summary>Próxima partida em destaque: mesas ativas, campanha recente, pendências necessárias e convite guardado.</summary>
    public async Task<object> HomeAsync(string user, CancellationToken ct)
    {
        var now = Now; var absent = now - OneShotLifecycleService.MasterAbsence;
        var mine = db.Campaigns.AsNoTracking().Where(c => (c.OwnerId == user || db.Members.Any(m => m.CampaignId == c.Id && m.UserId == user)) && c.ArchivedAt == null
            && (!c.IsOneShot || (c.ExpiresAt > now && (c.MasterLastSeenAt == null || c.MasterLastSeenAt > absent))));
        var active = await mine.Where(c => db.Sessions.Any(s => s.CampaignId == c.Id && s.EndedAt == null)).OrderByDescending(c => c.LastActivityAt).Take(5)
            .Select(c => new
            {
                c.Id, c.Name, c.System, c.IsOneShot, isMaster = c.OwnerId == user,
                session = db.Sessions.Where(s => s.CampaignId == c.Id && s.EndedAt == null).Select(s => new { s.Id, s.Number, s.Title, paused = s.PausedAt != null }).FirstOrDefault(),
                joined = db.Sessions.Where(s => s.CampaignId == c.Id && s.EndedAt == null).Any(s => db.SessionParticipants.Any(p => p.SessionId == s.Id && p.UserId == user)),
            }).ToListAsync(ct);
        var recent = await mine.Where(c => !c.IsOneShot).OrderByDescending(c => c.LastActivityAt).Take(3)
            .Select(c => new { c.Id, c.Name, c.System, isMaster = c.OwnerId == user, c.NextSessionAt, c.LastActivityAt }).ToListAsync(ct);
        var upcoming = await mine.Where(c => c.NextSessionAt != null && c.NextSessionAt > now.AddHours(-6)).OrderBy(c => c.NextSessionAt).Take(3)
            .Select(c => new
            {
                c.Id, c.Name, at = c.NextSessionAt, isMaster = c.OwnerId == user,
                attendance = db.Attendance.Where(a => a.CampaignId == c.Id && a.UserId == user && a.SessionAt == c.NextSessionAt).Select(a => a.Status).FirstOrDefault(),
            }).ToListAsync(ct);
        var pendingRequests = await db.RollRequests.AsNoTracking().Where(r => r.CancelledAt == null && r.ClosedAt == null
            && db.Sessions.Any(s => s.Id == r.SessionId && s.EndedAt == null && db.SessionParticipants.Any(p => p.SessionId == s.Id && p.UserId == user && !p.IsMaster)))
            .Select(r => new { r.SessionId, r.Targets }).Take(20).ToListAsync(ct);
        var characters = await db.Characters.CountAsync(c => c.OwnerId == user, ct);
        return new
        {
            active = active.Select(a => new { a.Id, a.Name, a.System, a.IsOneShot, a.isMaster, a.session, a.joined }),
            recent, upcoming = upcoming.Select(u => new { u.Id, u.Name, at = u.at is { } d ? DateTime.SpecifyKind(d, DateTimeKind.Utc) : (DateTime?)null, u.isMaster, u.attendance }),
            pendingInvite = await db.Users.Where(u => u.Id == user).Select(u => u.PendingInvite).SingleOrDefaultAsync(ct),
            pendingTests = pendingRequests.Count(r => r.Targets.Any(t => t.UserId == user && t.RespondedAt == null)),
            hasCharacters = characters > 0,
        };
    }

    // ---------- Modelos privados simples ----------
    public async Task<object> PrivateTemplatesAsync(Guid campaignId, string user, CancellationToken ct)
    {
        var (c, master) = await AccessAsync(campaignId, user, false, false, ct);
        var items = await db.SheetTemplates.AsNoTracking().Where(t => t.CampaignId == campaignId).OrderBy(t => t.Name)
            .Select(t => new
            {
                t.Id, t.Name, t.Description, inUse = c.SheetTemplateId == t.Id,
                version = db.SheetTemplateVersions.Where(v => v.Id == t.CurrentVersionId).Select(v => new { v.Id, v.Number, v.Fields, v.Actions }).FirstOrDefault(),
            }).ToListAsync(ct);
        return new { items, isMaster = master };
    }

    /// <summary>
    /// Cria ou atualiza um modelo privado sem PDF a partir de seções simples. Cada gravação publica uma nova versão
    /// pelo mesmo validador do catálogo; fichas existentes continuam na versão delas até a migração com prévia.
    /// </summary>
    public async Task<object> SavePrivateTemplateAsync(Guid campaignId, Guid? templateId, SimpleTemplateInput x, string user, CancellationToken ct)
    {
        var name = Text(x.Name, 100, "Dê um nome de até 100 caracteres ao modelo.", true);
        var description = Text(x.Description, 2000, "A descrição aceita até 2.000 caracteres.");
        var (pages, fields, actions) = BuildSimpleTemplate(x);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var campaign = db.Database.IsNpgsql()
            ? await db.Campaigns.FromSqlInterpolated($"SELECT * FROM \"Campaigns\" WHERE \"Id\" = {campaignId} FOR UPDATE").SingleOrDefaultAsync(ct)
            : await db.Campaigns.SingleOrDefaultAsync(c => c.Id == campaignId, ct);
        if (campaign == null) throw new RuleException(404, "Campanha não encontrada.");
        await AccessAsync(campaignId, user, true, true, ct);
        if (await db.SheetTemplates.AnyAsync(t => t.CampaignId == campaignId && t.Name == name && t.Id != templateId, ct)) throw new RuleException(409, "Já existe um modelo desta campanha com esse nome.");
        SheetTemplate template;
        if (templateId is { } tid)
            template = await db.SheetTemplates.SingleOrDefaultAsync(t => t.Id == tid && t.CampaignId == campaignId, ct) ?? throw new RuleException(404, "Modelo não encontrado.");
        else
        {
            if (await db.SheetTemplates.CountAsync(t => t.CampaignId == campaignId, ct) >= MaxPrivateTemplates) throw new RuleException(409, $"A campanha aceita até {MaxPrivateTemplates} modelos privados.");
            template = new SheetTemplate { RpgSystemId = campaign.RpgSystemId, CampaignId = campaignId, CreatedById = user };
            db.SheetTemplates.Add(template);
        }
        var number = templateId == null ? 1 : (await db.SheetTemplateVersions.Where(v => v.TemplateId == template.Id).MaxAsync(v => (int?)v.Number, ct) ?? 0) + 1;
        var version = new SheetTemplateVersion { TemplateId = template.Id, Number = number, Pages = pages, Fields = fields, Actions = actions, PublishedAt = Now, PublishedById = user };
        var issues = SheetTemplateService.ValidateForPublish(version);
        if (issues.Count > 0) throw new SheetValidationException(issues, "O modelo ainda tem problemas: " + string.Join(" ", issues.Take(3).Select(i => i.Message)));
        db.SheetTemplateVersions.Add(version);
        template.Name = name; template.Description = description; template.CurrentVersionId = version.Id; template.UpdatedAt = Now;
        if (templateId != null) template.Revision++;
        if (x.UseForCampaign) { campaign.SheetTemplateId = template.Id; campaign.Revision++; }
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return new { template.Id, versionId = version.Id, version.Number };
    }

    static readonly string[] SimpleTypes = [SheetFieldTypes.Text, SheetFieldTypes.Number, SheetFieldTypes.Select, SheetFieldTypes.Checkbox, SheetFieldTypes.TextArea];

    /// <summary>Converte seções simples em campos posicionados (duas colunas, páginas A4 em branco). Nomes técnicos são gerados.</summary>
    public static (List<SheetPage> Pages, List<SheetField> Fields, List<SheetActionDefinition> Actions) BuildSimpleTemplate(SimpleTemplateInput x)
    {
        var sections = x.Sections ?? [];
        var all = sections.SelectMany(s => (s.Fields ?? []).Select(f => (Section: (s.Title ?? "").Trim(), Field: f))).ToList();
        if (all.Count is < 1 or > MaxSimpleFields) throw new RuleException(400, $"Use de 1 a {MaxSimpleFields} campos.");
        if (sections.Any(s => (s.Title ?? "").Trim().Length > 60)) throw new RuleException(400, "O título da seção aceita até 60 caracteres.");
        var used = new HashSet<string>(StringComparer.Ordinal);
        string Slug(string label)
        {
            var normalized = new string(label.Normalize(NormalizationForm.FormD).Where(ch => CharUnicodeInfo.GetUnicodeCategory(ch) != UnicodeCategory.NonSpacingMark).ToArray()).ToLowerInvariant();
            var clean = Regex.Replace(normalized, "[^a-z0-9]+", "_").Trim('_');
            if (clean.Length == 0 || !char.IsAsciiLetterLower(clean[0])) clean = "campo_" + clean;
            clean = clean.Length > 34 ? clean[..34].TrimEnd('_') : clean;
            var candidate = clean; var n = 2;
            while (!used.Add(candidate)) candidate = $"{clean}_{n++}";
            return candidate;
        }
        var fields = new List<SheetField>();
        var byLabel = new Dictionary<string, SheetField>(StringComparer.OrdinalIgnoreCase);
        var hasName = all.Any(a => a.Field.Type == SheetFieldTypes.Text && string.Equals((a.Field.Label ?? "").Trim(), "Nome", StringComparison.OrdinalIgnoreCase));
        if (!hasName) all.Insert(0, ("Identidade", new SimpleFieldInput("Nome", SheetFieldTypes.Text, null, false, null, null, false, null, null)));
        foreach (var (section, f) in all)
        {
            var label = (f.Label ?? "").Trim();
            if (label.Length is < 1 or > 80) throw new RuleException(400, "Cada campo precisa de um nome com até 80 caracteres.");
            if (!SimpleTypes.Contains(f.Type)) throw new RuleException(400, $"{label}: escolha texto, número, seleção, marcação ou texto longo.");
            var field = new SheetField
            {
                Name = Slug(label), Label = label, Type = f.Type, Section = section.Length > 0 ? section : null,
                Options = f.Type == SheetFieldTypes.Select ? (f.Options ?? []).Select(o => o.Trim()).Where(o => o.Length > 0).Distinct().ToList() : [],
                Min = f.Type == SheetFieldTypes.Number ? f.Min : null, Max = f.Type == SheetFieldTypes.Number ? f.Max : null,
                Default = string.IsNullOrWhiteSpace(f.Default) ? null : f.Default.Trim(),
                Track = f.Resource ? SheetSummary.Resource : f.Summary ? SheetSummary.Highlight : null,
                MaxLength = f.Type is SheetFieldTypes.Text ? 200 : f.Type is SheetFieldTypes.TextArea ? 2000 : null,
            };
            if (f.Type == SheetFieldTypes.Select && field.Options.Count == 0) throw new RuleException(400, $"{label}: informe as opções da seleção.");
            if (f.Resource && f.Type != SheetFieldTypes.Number) throw new RuleException(400, $"{label}: recursos precisam ser numéricos.");
            if (!hasName && label == "Nome" && fields.Count == 0) field.Role = SheetFieldRoles.Name;
            else if (string.Equals(label, "Nome", StringComparison.OrdinalIgnoreCase) && f.Type == SheetFieldTypes.Text && !fields.Any(o => o.Role == SheetFieldRoles.Name)) field.Role = SheetFieldRoles.Name;
            fields.Add(field);
            byLabel.TryAdd(label, field);
        }
        foreach (var (section, f) in all.Where(a => a.Field.Resource && !string.IsNullOrWhiteSpace(a.Field.MaxFrom)))
        {
            var field = fields.First(x2 => x2.Label == (f.Label ?? "").Trim());
            if (!byLabel.TryGetValue(f.MaxFrom!.Trim(), out var max) || max.Type != SheetFieldTypes.Number || max == field) throw new RuleException(400, $"{field.Label}: o teto precisa ser outro campo numérico.");
            field.MaxField = max.Name; field.Max = null;
        }
        // Layout: duas colunas por página A4; texto longo ocupa a linha inteira.
        var pages = new List<SheetPage> { new() { Index = 0, Width = SheetTemplateLimits.A4Width, Height = SheetTemplateLimits.A4Height } };
        double y = 0.05; var column = 0; var page = 0; string? lastSection = null;
        foreach (var field in fields)
        {
            var wide = field.Type == SheetFieldTypes.TextArea;
            var h = wide ? 0.12 : 0.04;
            if (field.Section != lastSection) { if (column == 1) { column = 0; y += 0.06; } y += lastSection == null ? 0 : 0.02; lastSection = field.Section; }
            if (wide && column == 1) { column = 0; y += 0.06; }
            if (y + h > 0.95) { page++; y = 0.05; column = 0; pages.Add(new() { Index = page, Width = SheetTemplateLimits.A4Width, Height = SheetTemplateLimits.A4Height }); }
            field.Page = page; field.X = wide ? 0.06 : column == 0 ? 0.06 : 0.52; field.Y = y; field.W = wide ? 0.88 : 0.42; field.H = h;
            if (wide) y += h + 0.02;
            else if (column == 1) { column = 0; y += 0.06; }
            else column = 1;
        }
        var keys = new HashSet<string>(StringComparer.Ordinal);
        var actions = (x.Actions ?? []).Select(a =>
        {
            var n = (a.Name ?? "").Trim();
            if (n.Length is < 1 or > 60) throw new RuleException(400, "Cada ação precisa de um nome com até 60 caracteres.");
            var key = Slug("acao_" + n); keys.Add(key);
            return new SheetActionDefinition
            {
                Key = key, Name = n, Kind = ActionKinds.All.Contains(a.Kind) ? a.Kind! : ActionKinds.Skill,
                Formula = (a.Formula ?? "").Trim(), Description = (a.Description ?? "").Trim(), Group = string.IsNullOrWhiteSpace(a.Group) ? null : a.Group.Trim(),
            };
        }).ToList();
        if (actions.Count > TableRules.MaxActions) throw new RuleException(400, $"Use até {TableRules.MaxActions} ações.");
        return (pages, fields, actions);
    }
}
