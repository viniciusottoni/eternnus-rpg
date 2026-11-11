using System.Text.Json;
using Eternnus.Web;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Eternnus.Tests;

/// <summary>Ficha do jogador baseada em ficha-modelo (SQLite). HTTP, PostgreSQL e bloqueios reais: tests/character-sheets.mjs.</summary>
public sealed class CharacterSheetTests : IAsyncLifetime
{
    readonly SqliteConnection connection = new("Data Source=:memory:");
    GameDb db = null!;
    CharacterSheetService service = null!;
    SessionService sessions = null!;
    readonly Clock clock = new(new DateTimeOffset(2026, 11, 7, 20, 0, 0, TimeSpan.Zero));
    const string Master = "master", Player = "player", Other = "other";
    readonly Guid systemId = Guid.NewGuid(), templateId = Guid.NewGuid(), v1 = Guid.NewGuid();
    Campaign campaign = null!;

    static SheetField F(string name, string type, string? role = null, double y = 0.1) =>
        new() { Name = name, Label = "Rótulo " + name, Type = type, Role = role, X = 0.1, Y = y, W = 0.2, H = 0.03 };

    static List<SheetField> V1Fields()
    {
        var nivel = F("nivel", SheetFieldTypes.Number, SheetFieldRoles.Level); nivel.Min = 1; nivel.Max = 20; nivel.Default = "1";
        var pv = F("pv", SheetFieldTypes.Number, SheetFieldRoles.Hp); pv.Min = 0; pv.Default = "10";
        var pvMax = F("pv_max", SheetFieldTypes.Number, SheetFieldRoles.MaxHp); pvMax.Min = 1; pvMax.Default = "10";
        var forca = F("forca", SheetFieldTypes.Number); forca.Min = 0; forca.Max = 30; forca.Default = "14";
        var mod = F("forca_mod", SheetFieldTypes.Computed); mod.Formula = "floor((@forca - 10) / 2)";
        var classe = F("classe", SheetFieldTypes.Select); classe.Options = ["Guerreiro", "Mago"];
        var vivo = F("vivo", SheetFieldTypes.Checkbox); vivo.Default = "true";
        var historia = F("historia", SheetFieldTypes.TextArea); historia.MaxLength = 50;
        var apelido = F("apelido", SheetFieldTypes.Text); apelido.MaxLength = 10;
        return [F("nome", SheetFieldTypes.Text, SheetFieldRoles.Name), nivel, pv, pvMax, forca, mod, classe, vivo, historia, apelido];
    }

    public async Task InitializeAsync()
    {
        await connection.OpenAsync();
        db = new GameDb(new DbContextOptionsBuilder<GameDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        foreach (var id in new[] { Master, Player, Other }) db.Users.Add(new AppUser { Id = id, UserName = id, Email = id + "@segredo.test", DisplayName = "Nome " + id });
        await db.SaveChangesAsync();
        await SheetTemplateService.EnsureFreeTemplateAsync(db, default);
        db.RpgSystems.Add(new RpgSystem { Id = systemId, Name = "Tormenta", Slug = "tormenta" });
        db.SheetTemplates.Add(new SheetTemplate { Id = templateId, RpgSystemId = systemId, Name = "Ficha T20", IsDefault = true, CurrentVersionId = v1 });
        db.SheetTemplateVersions.Add(new SheetTemplateVersion
        {
            Id = v1, TemplateId = templateId, Number = 1, PublishedAt = clock.GetUtcNow().UtcDateTime, Pages = [new SheetPage()], Fields = V1Fields(),
            Actions = [new() { Key = "espada", Name = "Espada longa", Kind = ActionKinds.Attack, Formula = "1d20 + @forca_mod" }],
        });
        campaign = new Campaign { OwnerId = Master, Name = "Arton", RpgSystemId = systemId, System = "Tormenta" };
        db.AddRange(campaign, new Member { CampaignId = campaign.Id, UserId = Player });
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();
        sessions = new SessionService(db, new SessionSignals(), clock);
        service = new CharacterSheetService(db, sessions, new ProgressionService(db, new AuditService(db), clock), clock);
    }
    public async Task DisposeAsync() { await db.DisposeAsync(); await connection.DisposeAsync(); }

    static T Prop<T>(object o, string name) => (T)o.GetType().GetProperty(name)!.GetValue(o)!;
    static JsonElement Json(object o) => JsonSerializer.SerializeToElement(o, new JsonSerializerOptions(JsonSerializerDefaults.Web));
    static Dictionary<string, JsonElement> Values(params (string Key, object? Value)[] items) =>
        items.ToDictionary(i => i.Key, i => JsonSerializer.SerializeToElement(i.Value));
    static CharacterInput Classic(string name = "Tharion") => new(name, "Guerreiro", 3, 20, 25, 16, 12, 10, "Notas", 0, 14, 12, 9);
    static CharacterInput Modern(Guid? campaignId = null, Guid? templateId = null, Dictionary<string, JsonElement>? values = null, string name = "") =>
        new(name, null!, 0, 0, 0, 0, 0, 0, null!, 0, TemplateId: templateId, CampaignId: campaignId, Values: values ?? []);
    async Task<Character> Load(Guid id) { db.ChangeTracker.Clear(); return await db.Characters.AsNoTracking().SingleAsync(c => c.Id == id); }
    async Task<Character> CreateInCampaign() { var c = await service.CreateAsync(Modern(campaign.Id, values: Values(("nome", "Lysara"))), Player, default); db.ChangeTracker.Clear(); return c; }
    async Task<RuleException> Fails(Func<Task> action) => await Assert.ThrowsAsync<RuleException>(action);

    [Fact]
    public async Task Sheet_is_born_from_the_campaign_template_and_falls_back_to_the_free_template()
    {
        var c = await CreateInCampaign();
        var saved = await Load(c.Id);
        Assert.Equal(v1, saved.TemplateVersionId);
        var values = CharacterSheets.ParseValues(saved.Values);
        Assert.Equal("Lysara", values["nome"]); Assert.Equal("14", values["forca"]); Assert.Equal("true", values["vivo"]);
        Assert.False(values.ContainsKey("forca_mod"));
        Assert.Equal(("Lysara", 1, 10, 10), (saved.Name, saved.Level, saved.Hp, saved.MaxHp));
        Assert.True(await db.CampaignCharacters.AnyAsync(l => l.CampaignId == campaign.Id && l.CharacterId == c.Id));
        var template = await service.CampaignSheetTemplateAsync(campaign.Id, Player, default);
        Assert.Equal("default", Prop<string>(template, "source"));
        Assert.Equal(404, (await Fails(() => service.CampaignSheetTemplateAsync(campaign.Id, Other, default))).Status);

        // Sem modelo: formato clássico nasce no modelo do Sistema livre com as colunas mapeadas.
        var classic = await Load((await service.CreateAsync(Classic(), Player, default)).Id);
        Assert.Equal(SheetTemplateVersion.FreeTemplateV1Id, classic.TemplateVersionId);
        var free = CharacterSheets.ParseValues(classic.Values);
        Assert.Equal(("Tharion", "16", "14", "Notas", "25"), (free["nome"], free["forca"], free["constituicao"], free["notas"], free["vida_max"]));

        // Campanha de sistema sem modelo padrão → livre; mestre cria sem vincular; outro sistema recusado.
        var lonely = new Campaign { OwnerId = Master, Name = "Livre", RpgSystemId = Guid.NewGuid() };
        db.RpgSystems.Add(new RpgSystem { Id = lonely.RpgSystemId, Name = "Sem modelo", Slug = "sem-modelo" });
        db.Campaigns.Add(lonely); await db.SaveChangesAsync(); db.ChangeTracker.Clear();
        Assert.Equal("free", Prop<string>(await service.CampaignSheetTemplateAsync(lonely.Id, Master, default), "source"));
        var fallback = await service.CreateAsync(Modern(lonely.Id, name: "Mestre NPC"), Master, default);
        Assert.Equal(SheetTemplateVersion.FreeTemplateV1Id, fallback.TemplateVersionId);
        Assert.Equal("Mestre NPC", fallback.Name);
        Assert.False(await db.CampaignCharacters.AnyAsync(l => l.CharacterId == fallback.Id));
        Assert.Equal(400, (await Fails(() => service.CreateAsync(Modern(lonely.Id, templateId), Master, default))).Status);
        Assert.Equal(404, (await Fails(() => service.CreateAsync(Modern(campaign.Id), Other, default))).Status);
        Assert.Equal(400, (await Fails(() => service.CreateAsync(Modern(campaign.Id), Player, default))).Status);
    }

    [Fact]
    public async Task Legacy_sheet_is_read_as_the_free_template_and_converted_on_first_write()
    {
        var legacy = new Character { OwnerId = Player, Name = "Antigo", Archetype = "Ladino", Level = 4, Hp = 7, MaxHp = 12, Strength = 15, Notes = "velho" };
        db.Characters.Add(legacy); await db.SaveChangesAsync(); db.ChangeTracker.Clear();
        var view = Json(await service.SheetAsync(legacy.Id, Player, default));
        Assert.True(view.GetProperty("legacy").GetBoolean());
        Assert.Equal("Ladino", view.GetProperty("values").GetProperty("arquetipo").GetString());
        Assert.Equal("2", view.GetProperty("computed").GetProperty("forca_mod").GetString());
        var untouched = await Load(legacy.Id);
        Assert.Null(untouched.TemplateVersionId); Assert.Equal("{}", untouched.Values);

        await service.UpdateSheetAsync(legacy.Id, new(Values(("forca", "18")), null, 1), Player, default);
        var converted = await Load(legacy.Id);
        Assert.Equal(SheetTemplateVersion.FreeTemplateV1Id, converted.TemplateVersionId);
        Assert.Equal((18, 2), (converted.Strength, converted.Revision));
        Assert.Equal("velho", CharacterSheets.ParseValues(converted.Values)["notas"]);
        var history = await db.FieldChanges.AsNoTracking().Where(h => h.CharacterId == legacy.Id).ToListAsync();
        Assert.Equal("forca:15→18", Assert.Single(history) is var h ? $"{h.Field}:{h.OldValue}→{h.NewValue}" : "");
    }

    [Fact]
    public async Task Values_are_validated_by_type_and_computed_fields_are_ignored()
    {
        var c = await CreateInCampaign();
        async Task<int> Put(params (string, object?)[] values) => (await Fails(() => service.UpdateSheetAsync(c.Id, new(Values(values), null, 1), Player, default))).Status;
        Assert.Equal(400, await Put(("nivel", "21")));
        Assert.Equal(400, await Put(("nivel", "2.5")));
        Assert.Equal(400, await Put(("forca", "muito")));
        Assert.Equal(400, await Put(("apelido", "nome comprido demais")));
        Assert.Equal(400, await Put(("historia", new string('x', 51))));
        Assert.Equal(400, await Put(("vivo", "talvez")));
        Assert.Equal(400, await Put(("classe", "Bardo")));
        Assert.Equal(400, await Put(("nome", "  ")));
        Assert.Equal(400, await Put(("forca", new { x = 1 })));
        var view = Json(await service.UpdateSheetAsync(c.Id, new(Values(("forca_mod", "99"), ("inexistente", "x"), ("forca", 20), ("classe", "Mago"), ("vivo", false), ("apelido", "Lys")), null, 1), Player, default));
        Assert.Equal("5", view.GetProperty("computed").GetProperty("forca_mod").GetString());
        Assert.False(view.GetProperty("values").TryGetProperty("forca_mod", out _));
        Assert.False(view.GetProperty("values").TryGetProperty("inexistente", out _));
        Assert.Equal(("20", "Mago", "false"), (view.GetProperty("values").GetProperty("forca").GetString(), view.GetProperty("values").GetProperty("classe").GetString(), view.GetProperty("values").GetProperty("vivo").GetString()));
        Assert.DoesNotContain("forca_mod", (await Load(c.Id)).Values);
    }

    [Fact]
    public async Task Role_fields_mirror_classic_columns_hp_stays_within_max_and_stale_revision_conflicts()
    {
        var c = await CreateInCampaign();
        await service.UpdateSheetAsync(c.Id, new(Values(("nome", "Lysara Vento"), ("nivel", "7"), ("pv", "30"), ("pv_max", "18")), null, 1), Player, default);
        var saved = await Load(c.Id);
        Assert.Equal(("Lysara Vento", 7, 18, 18), (saved.Name, saved.Level, saved.Hp, saved.MaxHp));
        Assert.Equal("18", CharacterSheets.ParseValues(saved.Values)["pv"]);
        Assert.Equal(409, (await Fails(() => service.UpdateSheetAsync(c.Id, new(Values(("nivel", "8")), null, 1), Player, default))).Status);
        Assert.Equal(404, (await Fails(() => service.UpdateSheetAsync(c.Id, new(Values(("nivel", "8")), null, 2), Other, default))).Status);
        Assert.Equal(404, (await Fails(() => service.SheetAsync(c.Id, Other, default))).Status);
        Assert.Equal(404, (await Fails(() => service.FieldHistoryAsync(c.Id, null, 1, Other, default))).Status);
        // Snapshot de versão continua sendo gerado.
        Assert.True(await db.Versions.AnyAsync(v => v.CharacterId == c.Id && v.Revision == 2));
    }

    [Fact]
    public async Task Field_history_is_individual_paginated_and_never_exposes_email()
    {
        var c = await CreateInCampaign();
        for (var i = 0; i < 22; i++)
            await service.UpdateSheetAsync(c.Id, new(Values(("forca", (i % 2 == 0 ? 15 : 14).ToString()), ("apelido", "a" + i)), null, i + 1), Player, default);
        var page1 = Json(await service.FieldHistoryAsync(c.Id, null, 1, Player, default));
        Assert.Equal(44, page1.GetProperty("total").GetInt32());
        Assert.Equal(15, page1.GetProperty("items").GetArrayLength());
        var forca = Json(await service.FieldHistoryAsync(c.Id, "forca", 2, Player, default));
        Assert.Equal(22, forca.GetProperty("total").GetInt32());
        Assert.Equal(7, forca.GetProperty("items").GetArrayLength());
        var first = forca.GetProperty("items")[6];
        Assert.Equal(("14", "15", "Rótulo forca", "edit", "Nome player"), (first.GetProperty("oldValue").GetString(), first.GetProperty("newValue").GetString(), first.GetProperty("label").GetString(), first.GetProperty("source").GetString(), first.GetProperty("changedBy").GetString()));
        Assert.DoesNotContain("@segredo", page1.GetRawText());
        Assert.Equal(400, (await Fails(() => service.FieldHistoryAsync(c.Id, "DROP TABLE", 1, Player, default))).Status);
    }

    [Fact]
    public async Task Migration_previews_and_applies_matching_by_name_preserving_history()
    {
        var c = await CreateInCampaign();
        await service.UpdateSheetAsync(c.Id, new(Values(("apelido", "Lys"), ("historia", "Nasceu em Valkaria"), ("classe", "Mago"), ("vivo", "true")), null, 1), Player, default);
        Assert.Equal(409, (await Fails(() => service.MigrationPreviewAsync(c.Id, Player, default))).Status);
        Assert.True(Json(await service.SheetAsync(c.Id, Player, default)).GetProperty("newerVersion").ValueKind == JsonValueKind.Null);

        // v2: apelido → alcunha (renomeado = removido + novo); historia removida; classe vira texto; vivo vira número; mana nova.
        var fields = V1Fields().Where(f => f.Name is not ("apelido" or "historia")).ToList();
        fields.Single(f => f.Name == "classe").Type = SheetFieldTypes.Text;
        fields.Single(f => f.Name == "classe").Options = [];
        var vivo = fields.Single(f => f.Name == "vivo"); vivo.Type = SheetFieldTypes.Number; vivo.Default = "1";
        var mana = F("mana", SheetFieldTypes.Number); mana.Default = "5"; fields.Add(mana);
        fields.Add(F("alcunha", SheetFieldTypes.Text));
        var v2 = new SheetTemplateVersion { TemplateId = templateId, Number = 2, PublishedAt = clock.GetUtcNow().UtcDateTime, Pages = [new SheetPage()], Fields = fields };
        db.SheetTemplateVersions.Add(v2);
        var t = await db.SheetTemplates.SingleAsync(x => x.Id == templateId); t.CurrentVersionId = v2.Id;
        await db.SaveChangesAsync(); db.ChangeTracker.Clear();

        var newer = Json(await service.SheetAsync(c.Id, Player, default)).GetProperty("newerVersion");
        Assert.Equal(2, newer.GetProperty("number").GetInt32());
        var preview = Json(await service.MigrationPreviewAsync(c.Id, Player, default));
        static string[] Names(JsonElement e) => e.EnumerateArray().Select(x => x.GetProperty("name").GetString()!).OrderBy(x => x).ToArray();
        Assert.Equal(["alcunha", "mana"], Names(preview.GetProperty("added")));
        Assert.Equal(["apelido", "historia"], Names(preview.GetProperty("removed")));
        Assert.Equal(["classe", "vivo"], Names(preview.GetProperty("changed")));
        var changed = preview.GetProperty("changed").EnumerateArray().ToDictionary(x => x.GetProperty("name").GetString()!);
        Assert.Equal(("Mago", "type"), (changed["classe"].GetProperty("newValue").GetString(), changed["classe"].GetProperty("reason").GetString()));
        Assert.Equal(("1", "reset"), (changed["vivo"].GetProperty("newValue").GetString(), changed["vivo"].GetProperty("reason").GetString()));
        Assert.Contains("forca", Names(preview.GetProperty("kept")));
        Assert.Equal(v1, (await Load(c.Id)).TemplateVersionId);

        Assert.Equal(409, (await Fails(() => service.MigrateAsync(c.Id, new(v2.Id, 1), Player, default))).Status);
        Assert.Equal(409, (await Fails(() => service.MigrateAsync(c.Id, new(v1, 2), Player, default))).Status);
        await service.MigrateAsync(c.Id, new(v2.Id, 2), Player, default);
        var migrated = await Load(c.Id);
        Assert.Equal((v2.Id, 3), (migrated.TemplateVersionId!.Value, migrated.Revision));
        var values = CharacterSheets.ParseValues(migrated.Values);
        Assert.False(values.ContainsKey("historia")); Assert.Equal("5", values["mana"]); Assert.Equal("Mago", values["classe"]);
        var history = await db.FieldChanges.AsNoTracking().Where(h => h.CharacterId == c.Id && h.Source == FieldChangeSources.Migration).ToListAsync();
        Assert.Contains(history, h => h.Field == "historia" && h.OldValue == "Nasceu em Valkaria" && h.NewValue == "" && h.TemplateVersionId == v2.Id);
        Assert.Contains(history, h => h.Field == "apelido" && h.OldValue == "Lys");
        Assert.Contains(history, h => h.Field == "mana" && h.NewValue == "5");
        Assert.Equal(409, (await Fails(() => service.MigrationPreviewAsync(c.Id, Player, default))).Status);
    }

    [Fact]
    public async Task Table_actions_use_sheet_fields_and_legacy_formulas_and_master_hp_updates_the_field()
    {
        var c = await CreateInCampaign();
        await service.UpdateSheetAsync(c.Id, new(Values(("forca", "18")), [new() { Id = "velho", Name = "Velho", Kind = ActionKinds.Attack, Formula = "1d3 + 2" }, new() { Id = "novo", Name = "Novo", Kind = ActionKinds.Spell, Formula = "1d4 + @forca_mod * 2" }], 1), Player, default);
        Assert.Equal(400, (await Fails(() => service.UpdateSheetAsync(c.Id, new(null, [new() { Name = "Erro", Kind = ActionKinds.Spell, Formula = "1d4 + @inexistente" }], 2), Player, default))).Status);
        Assert.Equal("1d3+2", (await Load(c.Id)).Actions[0].Formula);
        var started = await sessions.StartAsync(campaign.Id, new("Sessão", "", MapKinds.Tileset, "crypt"), Master, default);
        var sid = Prop<Guid>(started, "Id");
        await sessions.JoinAsync(sid, c.Id, Player, default);
        await sessions.NextTurnAsync(sid, Master, default);
        db.ChangeTracker.Clear();

        var templateRoll = Assert.IsType<ActionRoll>(Prop<object>(await sessions.UseActionAsync(sid, new(ActionKinds.Attack, "t:espada", "Goblin"), Player, default), "roll"));
        Assert.Equal(templateRoll.Values[0] + 4, templateRoll.Total);
        Assert.Equal(4, templateRoll.Modifier);
        db.ChangeTracker.Clear();
        var legacyRoll = Assert.IsType<DiceResult>(Prop<object>(await sessions.UseActionAsync(sid, new(ActionKinds.Attack, "velho", null), Player, default), "roll"));
        Assert.InRange(legacyRoll.Total, 3, 5);
        db.ChangeTracker.Clear();
        var newRoll = Assert.IsType<ActionRoll>(Prop<object>(await sessions.UseActionAsync(sid, new(ActionKinds.Spell, "novo", null), Player, default), "roll"));
        Assert.Equal(newRoll.Values[0] + 8, newRoll.Total);
        db.ChangeTracker.Clear();
        Assert.Equal(404, (await Fails(() => sessions.UseActionAsync(sid, new(ActionKinds.Spell, "t:espada", null), Player, default))).Status);
        db.ChangeTracker.Clear();

        await sessions.AdjustHpAsync(sid, c.Id, new(-4, "Flecha"), Master, default);
        var hurt = await Load(c.Id);
        Assert.Equal((6, "6"), (hurt.Hp, CharacterSheets.ParseValues(hurt.Values)["pv"]));
        var change = await db.FieldChanges.AsNoTracking().SingleAsync(h => h.CharacterId == c.Id && h.Source == FieldChangeSources.Master);
        Assert.Equal(("pv", "10", "6", sid, Master), (change.Field, change.OldValue, change.NewValue, change.SessionId!.Value, change.ChangedById));

        // Edição do jogador com sessão ativa: histórico com SessionId e evento com rótulo na linha do tempo.
        await service.UpdateSheetAsync(c.Id, new(Values(("apelido", "Lys")), null, hurt.Revision), Player, default);
        Assert.Equal(sid, (await db.FieldChanges.AsNoTracking().SingleAsync(h => h.CharacterId == c.Id && h.Field == "apelido")).SessionId);
        Assert.True(await db.Events.AnyAsync(e => e.SessionId == sid && e.Kind == EventKinds.Sheet && e.Content.Contains("Rótulo apelido")));

        // Mestre vê a ficha do participante com modelo + calculados; o outro jogador não.
        var masterView = Json(await sessions.SheetAsync(sid, c.Id, Master, default));
        Assert.Equal("4", masterView.GetProperty("sheet").GetProperty("computed").GetProperty("forca_mod").GetString());
        Assert.Equal(6, masterView.GetProperty("hp").GetInt32());
        db.Members.Add(new Member { CampaignId = campaign.Id, UserId = Other }); await db.SaveChangesAsync();
        Assert.Equal(6, Json(await sessions.SheetAsync(sid, c.Id, Other, default)).GetProperty("hp").GetInt32());
        Assert.Equal(404, (await Fails(() => service.FieldHistoryAsync(c.Id, null, 1, Other, default))).Status);
    }

    [Fact]
    public async Task Classic_put_keeps_values_coherent_and_template_versions_stay_readable()
    {
        var c = await service.CreateAsync(Classic(), Player, default);
        db.ChangeTracker.Clear();
        await service.UpdateClassicAsync(c.Id, Classic("Tharion II") with { Revision = 1, Strength = 20 }, Player, default);
        var free = await Load(c.Id);
        var values = CharacterSheets.ParseValues(free.Values);
        Assert.Equal(("Tharion II", "20"), (values["nome"], values["forca"]));
        Assert.Contains(await db.FieldChanges.AsNoTracking().Where(h => h.CharacterId == c.Id).Select(h => h.Field).ToListAsync(), f => f == "forca");

        // Ficha de outro modelo: PUT antigo espelha só os papéis.
        var t20 = await CreateInCampaign();
        await service.UpdateClassicAsync(t20.Id, Classic("Lysara") with { Revision = 1, Level = 5, Hp = 9, MaxHp = 12 }, Player, default);
        var mirrored = CharacterSheets.ParseValues((await Load(t20.Id)).Values);
        Assert.Equal(("5", "9", "12", "14"), (mirrored["nivel"], mirrored["pv"], mirrored["pv_max"], mirrored["forca"]));

        // Versão antiga publicada continua legível (GetVersionAsync) para quem tem a ficha, mesmo não sendo a atual.
        var v2 = new SheetTemplateVersion { TemplateId = templateId, Number = 2, PublishedAt = clock.GetUtcNow().UtcDateTime, Pages = [new SheetPage()], Fields = V1Fields() };
        db.SheetTemplateVersions.Add(v2);
        (await db.SheetTemplates.SingleAsync(x => x.Id == templateId)).CurrentVersionId = v2.Id;
        await db.SaveChangesAsync(); db.ChangeTracker.Clear();
        var templates = new SheetTemplateService(db, new AuditService(db));
        Assert.Equal(1, Prop<int>(await templates.GetVersionAsync(templateId, v1, Player, default), "Number"));
    }

    [Fact]
    public void Player_action_formulas_accept_the_formula_language_and_old_dice()
    {
        var numeric = new HashSet<string> { "nivel", "forca_mod" };
        var actions = new List<CharacterAction>
        {
            new() { Name = "Velho", Kind = ActionKinds.Attack, Formula = " 1d3 + 2 " },
            new() { Name = "Novo", Kind = ActionKinds.Spell, Formula = "if  @nivel>5 then 2d6 else 1d6" },
        };
        Assert.Null(TableRules.ValidateActions(actions, numeric));
        Assert.Equal(("1d3+2", "if @nivel>5 then 2d6 else 1d6"), (actions[0].Formula, actions[1].Formula));
        Assert.NotNull(TableRules.ValidateActions([new() { Name = "X", Kind = ActionKinds.Spell, Formula = "1d6 + @desconhecido" }], numeric));
        Assert.NotNull(TableRules.ValidateActions([new() { Name = "X", Kind = ActionKinds.Spell, Formula = "1d1" }], numeric));
        Assert.NotNull(TableRules.ValidateActions([new() { Name = "X", Kind = ActionKinds.Spell, Formula = "1d6 + " + new string('1', 40) }], numeric));
        Assert.True(TableRules.IsLegacyFormula("2d6 - 1"));
        Assert.False(TableRules.IsLegacyFormula("1d20 + @forca"));
        var roll = Assert.IsType<ActionRoll>(CharacterSheets.Roll("2d6kh1 + @nivel", new Dictionary<string, double> { ["nivel"] = 3 }));
        Assert.Equal(roll.Values.Single() + 3, roll.Total);
        Assert.Equal(400, Assert.Throws<RuleException>(() => CharacterSheets.Roll("1d7 + x", new Dictionary<string, double>())).Status);
        var diff = TableRules.DiffValues(V1Fields(), new Dictionary<string, string> { ["forca"] = "10", ["historia"] = new string('a', 100) }, new Dictionary<string, string> { ["forca"] = "12", ["historia"] = "b" });
        Assert.Equal(["Rótulo forca", "Rótulo historia"], diff.Select(d => d.Label));
        Assert.True(diff[1].Before.Length <= 60);
    }

    [Fact]
    public async Task Shared_sheets_are_readable_but_edits_and_audit_stay_with_owner_and_master()
    {
        var c = await CreateInCampaign();
        db.Members.Add(new() { CampaignId = campaign.Id, UserId = Other }); await db.SaveChangesAsync();
        var started = Json(await sessions.StartAsync(campaign.Id, new("Mesa", "", MapKinds.Tileset, "crypt"), Master, default));
        var sid = started.GetProperty("id").GetGuid();
        await sessions.JoinAsync(sid, c.Id, Player, default);
        Assert.False(Json(await sessions.SheetAsync(sid, c.Id, Other, default)).GetProperty("canEdit").GetBoolean());
        Assert.Equal(404, (await Fails(() => service.UpdateSheetAsync(c.Id, new(Values(("apelido", "Intruso")), null, 1), Other, default))).Status);
        db.ChangeTracker.Clear();

        Assert.Equal(403, (await Fails(() => service.UpdateSheetAsync(c.Id, new(null, null, 1, Private: true), Master, default))).Status);
        db.ChangeTracker.Clear();
        await service.UpdateSheetAsync(c.Id, new(Values(("apelido", "Sigilo")), null, 1), Master, default);
        db.ChangeTracker.Clear();
        var changed = Json(await service.UpdateSheetAsync(c.Id, new(null, null, 2, Private: true), Player, default));
        Assert.True(changed.GetProperty("private").GetBoolean());
        Assert.Equal(404, (await Fails(() => sessions.SheetAsync(sid, c.Id, Other, default))).Status);
        Assert.Equal(404, (await Fails(() => service.SheetAsync(c.Id, Other, default))).Status);
        Assert.Equal(404, (await Fails(() => service.FieldHistoryAsync(c.Id, null, 1, Other, default))).Status);
        var audit = await db.Events.AsNoTracking().SingleAsync(e => e.SessionId == sid && e.Kind == EventKinds.Sheet && e.UserId == Master);
        Assert.Equal((Master, sid, Player, true), (audit.UserId, audit.SessionId!.Value, audit.VisibleToUserId, audit.MasterOnly));
        Assert.Contains("Sigilo", Json(await service.FieldHistoryAsync(c.Id, null, 1, Master, default)).ToString());
        Assert.DoesNotContain(Json(await sessions.StateAsync(sid, Other, default)).GetProperty("events").EnumerateArray(), e => e.GetProperty("content").GetString() == audit.Content);
        Assert.Contains(Json(await sessions.StateAsync(sid, Player, default)).GetProperty("events").EnumerateArray(), e => e.GetProperty("content").GetString() == audit.Content);
        var version = await db.Versions.AsNoTracking().SingleAsync(v => v.CharacterId == c.Id && v.Revision == 2);
        Assert.Equal((Master, sid), (version.ChangedById, version.SessionId!.Value));
        var otherState = Json(await sessions.StateAsync(sid, Other, default));
        var player = otherState.GetProperty("participants").EnumerateArray().Single(p => p.GetProperty("userId").GetString() == Player);
        Assert.Equal(JsonValueKind.Null, player.GetProperty("hp").ValueKind);
        Assert.False(player.GetProperty("canView").GetBoolean());
    }

    [Fact]
    public async Task Same_size_action_edits_have_exact_snapshots_and_private_session_audit()
    {
        var c = await CreateInCampaign();
        var sid = Json(await sessions.StartAsync(campaign.Id, new("Mesa", "", MapKinds.Tileset, "crypt"), Master, default)).GetProperty("id").GetGuid();
        var first = new CharacterAction { Id = "pessoal", Name = "Espada", Kind = ActionKinds.Attack, Formula = "1d6" };
        await service.UpdateSheetAsync(c.Id, new(null, [first], 1), Player, default);
        db.ChangeTracker.Clear();
        await service.UpdateSheetAsync(c.Id, new(null, [new() { Id = first.Id, Name = "Espada afiada", Kind = first.Kind, Formula = "1d8" }], 2), Player, default);
        var changes = await db.FieldChanges.AsNoTracking().Where(h => h.CharacterId == c.Id && h.Field == "actions").ToListAsync();
        Assert.Equal(2, changes.Count);
        Assert.Contains("1d8", changes[1].NewValue); Assert.Contains("1d6", changes[1].OldValue);
        Assert.All(changes, h => { Assert.Equal(Player, h.ChangedById); Assert.Equal(sid, h.SessionId); });
        Assert.Equal(2, await db.Events.CountAsync(e => e.SessionId == sid && e.Kind == EventKinds.Sheet && e.MasterOnly && e.VisibleToUserId == Player));
        Assert.Contains("1d8", (await db.Versions.AsNoTracking().SingleAsync(v => v.CharacterId == c.Id && v.Revision == 3)).Snapshot);
    }

    [Fact]
    public async Task A_character_from_another_system_cannot_join_the_campaign()
    {
        var wrong = await service.CreateAsync(Classic(), Player, default);
        var sid = Json(await sessions.StartAsync(campaign.Id, new("Mesa", "", MapKinds.Tileset, "crypt"), Master, default)).GetProperty("id").GetGuid();
        db.ChangeTracker.Clear();
        var entry = Json(await sessions.EntryAsync(campaign.Id, Player, default));
        Assert.DoesNotContain(wrong.Id.ToString(), entry.GetProperty("characters").ToString());
        // A ficha incompatível aparece com o motivo, para o jogador criar uma ficha com o modelo da campanha.
        Assert.Contains(wrong.Id.ToString(), entry.GetProperty("incompatible").ToString());
        Assert.Equal(400, (await Fails(() => sessions.JoinAsync(sid, wrong.Id, Player, default))).Status);
        db.ChangeTracker.Clear();
        Assert.False(await db.SessionParticipants.AnyAsync(p => p.SessionId == sid && p.UserId == Player));
        Assert.False(await db.CampaignCharacters.AnyAsync(p => p.CharacterId == wrong.Id));
    }

    sealed class Clock(DateTimeOffset start) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => start;
    }
}
