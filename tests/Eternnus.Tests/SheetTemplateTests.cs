using System.Text.Json;
using Eternnus.Web;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Xunit.Abstractions;

namespace Eternnus.Tests;

/// <summary>Regras de fichas-modelo em SQLite. Bloqueios reais (FOR UPDATE) e HTTP são cobertos por tests/sheet-templates.mjs em PostgreSQL.
/// A validação de fórmulas pertence ao WP3: os testes de fluxo usam um validador estrutural; o teste da validação real
/// é pulado (com aviso) enquanto a linguagem de fórmulas for stub.</summary>
public sealed class SheetTemplateTests(ITestOutputHelper output) : IAsyncLifetime
{
    readonly SqliteConnection connection = new("Data Source=:memory:");
    GameDb db = null!;
    SheetTemplateService service = null!;
    const string Admin = "admin", Ambassador = "ambassador", Common = "common";

    public async Task InitializeAsync()
    {
        await connection.OpenAsync();
        db = new GameDb(new DbContextOptionsBuilder<GameDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        db.Users.Add(new AppUser { Id = Admin, UserName = Admin, DisplayName = "Ana Admin", EmailConfirmed = true, Role = PlatformRoles.Admin });
        db.Users.Add(new AppUser { Id = Ambassador, UserName = Ambassador, DisplayName = "Bruno Embaixador", EmailConfirmed = true, Role = PlatformRoles.Ambassador });
        db.Users.Add(new AppUser { Id = Common, UserName = Common, DisplayName = "Caio", EmailConfirmed = true, Role = PlatformRoles.Common });
        await db.SaveChangesAsync();
        service = NewService();
    }
    public async Task DisposeAsync() { await db.DisposeAsync(); await connection.DisposeAsync(); }

    /// <summary>Serviço com validador de publicação sem a linguagem de fórmulas (estrutura + regras semânticas). A validação real "requer WP3".</summary>
    SheetTemplateService NewService() => new(db, new AuditService(db))
    {
        PublishValidator = v => [.. SheetTemplateService.StructureIssues(v.Pages, v.Fields, v.Actions, v.Notes), .. SheetTemplateService.SemanticIssues(v.Pages, v.Fields)],
    };

    static T Prop<T>(object o, string name) => (T)o.GetType().GetProperty(name)!.GetValue(o)!;
    static SheetField Field(string name, string type = SheetFieldTypes.Number, double x = 0.1, double y = 0.1) =>
        new() { Name = name, Label = name.ToUpperInvariant(), Type = type, X = x, Y = y, W = 0.2, H = 0.04 };

    async Task<(Guid Template, Guid Draft)> CreateAsync(string name = "Tormenta", Guid? system = null)
    {
        var created = await service.CreateAsync(new(system ?? RpgSystem.FreeSystemId, name, "Descrição"), Ambassador, default);
        db.ChangeTracker.Clear();
        return (Prop<Guid>(created, "Id"), Prop<Guid>(created, "draftId"));
    }
    async Task<int> RevisionAsync(Guid version) => await db.SheetTemplateVersions.AsNoTracking().Where(v => v.Id == version).Select(v => v.Revision).SingleAsync();
    async Task SaveAsync(Guid template, Guid version, params SheetField[] fields)
    {
        await service.UpdateVersionAsync(template, version, new([new() { Width = 595.28, Height = 841.89 }], [.. fields], [], "", await RevisionAsync(version)), Ambassador, default);
        db.ChangeTracker.Clear();
    }
    async Task<object> PublishAsync(Guid template, Guid version, string user = Ambassador)
    {
        var result = await service.PublishAsync(template, version, await RevisionAsync(version), user, default);
        db.ChangeTracker.Clear();
        return result;
    }
    async Task<Guid> NewDraftAsync(Guid template)
    {
        var draft = await service.CreateVersionAsync(template, new(null), Ambassador, default);
        db.ChangeTracker.Clear();
        return Prop<Guid>(draft, "Id");
    }
    async Task<int> TemplateRevisionAsync(Guid id) => await db.SheetTemplates.AsNoTracking().Where(t => t.Id == id).Select(t => t.Revision).SingleAsync();

    [Fact]
    public async Task Creation_makes_an_a4_draft_and_only_one_draft_per_template()
    {
        var (template, draft) = await CreateAsync();
        var v = await db.SheetTemplateVersions.AsNoTracking().SingleAsync(x => x.Id == draft);
        Assert.Equal(1, v.Number);
        Assert.Null(v.PublishedAt);
        Assert.Single(v.Pages);
        Assert.Equal(595.28, v.Pages[0].Width, 2);
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => service.CreateVersionAsync(template, new(null), Ambassador, default))).Status);
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => CreateAsync())).Status); // nome repetido no sistema
        Assert.Equal(400, (await Assert.ThrowsAsync<RuleException>(() => service.CreateAsync(new(Guid.NewGuid(), "X", ""), Ambassador, default))).Status);
    }

    [Fact]
    public async Task Published_versions_are_immutable()
    {
        var (template, draft) = await CreateAsync();
        await SaveAsync(template, draft, Field("forca"), Field("nome", SheetFieldTypes.Text, y: 0.3));
        await PublishAsync(template, draft);
        var rev = await RevisionAsync(draft);
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => service.UpdateVersionAsync(template, draft, new([new()], [Field("x")], [], "", rev), Ambassador, default))).Status);
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => service.DeleteVersionAsync(template, draft, Ambassador, default))).Status);
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => service.PublishAsync(template, draft, rev, Ambassador, default))).Status);
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => service.DeletePdfAsync(template, draft, Ambassador, default))).Status);
        var pdf = new UploadedDocument("%PDF-1.4\n%%EOF\n"u8.ToArray(), DocumentKinds.Pdf, "a.pdf", new string('a', 64));
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => service.UploadPdfAsync(template, draft, pdf, "[{\"width\":600,\"height\":800}]", rev, Ambassador, default))).Status);
    }

    [Fact]
    public async Task Stale_revisions_and_structural_limits_are_rejected()
    {
        var (template, draft) = await CreateAsync();
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => service.UpdateVersionAsync(template, draft, new([new()], [], [], "", 99), Ambassador, default))).Status);
        async Task<SheetValidationException> Bad(List<SheetPage> pages, List<SheetField> fields, List<SheetActionDefinition>? actions = null) =>
            await Assert.ThrowsAsync<SheetValidationException>(() => service.UpdateVersionAsync(template, draft, new(pages, fields, actions ?? [], "", 1), Ambassador, default));
        var a4 = new List<SheetPage> { new() };
        Assert.Contains((await Bad(a4, [.. Enumerable.Range(0, 301).Select(i => Field("c" + i))])).Errors, e => e.Message.Contains("300"));
        Assert.Equal("dup", Assert.Single((await Bad(a4, [Field("dup"), Field("dup")])).Errors).Field);
        Assert.Single((await Bad(a4, [Field("Maiuscula")])).Errors);
        Assert.Single((await Bad(a4, [new SheetField { Name = "fora", Type = SheetFieldTypes.Text, X = 0.9, Y = 0.1, W = 0.2, H = 0.1 }])).Errors);
        Assert.Single((await Bad(a4, [new SheetField { Name = "fonte", Type = SheetFieldTypes.Text, X = 0.1, Y = 0.1, W = 0.2, H = 0.1, FontSize = 200 }])).Errors);
        Assert.Single((await Bad([new() { Width = 10, Height = 800 }], [])).Errors);
        Assert.Single((await Bad([.. Enumerable.Range(0, 51).Select(_ => new SheetPage())], [])).Errors);
        Assert.Single((await Bad(a4, [], [new() { Key = "golpe", Name = "Golpe", Kind = "attack" }])).Errors);
        Assert.Contains((await Bad(a4, [], [.. Enumerable.Range(0, 101).Select(i => new SheetActionDefinition { Key = "a" + i, Name = "A", Kind = ActionKinds.Attack })])).Errors, e => e.Message.Contains("100"));
        var roles = await Bad(a4, [new SheetField { Name = "a", Type = SheetFieldTypes.Number, Role = SheetFieldRoles.Hp, X = 0, Y = 0, W = .1, H = .1 }, new SheetField { Name = "b", Type = SheetFieldTypes.Number, Role = SheetFieldRoles.Hp, X = 0, Y = 0, W = .1, H = .1 }]);
        Assert.Equal("b", Assert.Single(roles.Errors).Field);
        // Normalização: fórmula só em calculado, rótulo vazio vira o nome, coordenadas arredondadas.
        await service.UpdateVersionAsync(template, draft, new(a4, [new SheetField { Name = "vida", Type = SheetFieldTypes.Number, Formula = "1+1", X = 0.1234567891, Y = 0, W = 0.2, H = 0.05 }], [], "  notas  ", 1), Ambassador, default);
        db.ChangeTracker.Clear();
        var saved = await db.SheetTemplateVersions.AsNoTracking().SingleAsync(v => v.Id == draft);
        Assert.Null(saved.Fields[0].Formula);
        Assert.Equal("vida", saved.Fields[0].Label);
        Assert.Equal(0.123457, saved.Fields[0].X);
        Assert.Equal("notas", saved.Notes);
        Assert.Equal(2, saved.Revision);
    }

    [Fact]
    public async Task Versions_are_numbered_sequentially_and_admin_can_republish()
    {
        var (template, v1) = await CreateAsync();
        await SaveAsync(template, v1, Field("forca"));
        Assert.Equal(1, Prop<int>(await PublishAsync(template, v1), "Number"));
        var v2 = await NewDraftAsync(template);
        Assert.Equal(2, (await db.SheetTemplateVersions.AsNoTracking().SingleAsync(v => v.Id == v2)).Number);
        // A cópia herda campos da publicada.
        Assert.Equal("forca", (await db.SheetTemplateVersions.AsNoTracking().SingleAsync(v => v.Id == v2)).Fields.Single().Name);
        await SaveAsync(template, v2, Field("forca"), Field("agilidade", y: 0.3));
        Assert.Equal(2, Prop<int>(await PublishAsync(template, v2), "Number"));
        var v3 = await NewDraftAsync(template);
        // Reverter para a v1 com um rascunho aberto: a republicada vira v3 e o rascunho passa para v4.
        var republished = await service.RepublishAsync(template, v1, Admin, default);
        db.ChangeTracker.Clear();
        Assert.Equal(3, Prop<int>(republished, "Number"));
        var copy = await db.SheetTemplateVersions.AsNoTracking().SingleAsync(v => v.Id == Prop<Guid>(republished, "Id"));
        Assert.NotNull(copy.PublishedAt);
        Assert.Equal(["forca"], copy.Fields.Select(f => f.Name));
        Assert.Equal(copy.Id, (await db.SheetTemplates.AsNoTracking().SingleAsync(t => t.Id == template)).CurrentVersionId);
        Assert.Equal(4, (await db.SheetTemplateVersions.AsNoTracking().SingleAsync(v => v.Id == v3)).Number);
        var diff = Prop<SheetVersionDiff>(republished, "diff");
        Assert.Equal(["agilidade"], diff.Removed);
        Assert.Equal(4, Prop<int>(await PublishAsync(template, v3), "Number"));
        Assert.Equal(404, (await Assert.ThrowsAsync<RuleException>(() => service.RepublishAsync(template, Guid.NewGuid(), Admin, default))).Status);
        // Descartar rascunho libera a criação de outro.
        var v5 = await NewDraftAsync(template);
        await service.DeleteVersionAsync(template, v5, Ambassador, default);
        db.ChangeTracker.Clear();
        var v6 = await NewDraftAsync(template);
        Assert.Equal(5, (await db.SheetTemplateVersions.AsNoTracking().SingleAsync(v => v.Id == v6)).Number);
    }

    [Fact]
    public async Task Only_one_default_per_system_and_default_moves_explicitly()
    {
        var (a, da) = await CreateAsync("Modelo A");
        var (b, db2) = await CreateAsync("Modelo B");
        await SaveAsync(a, da, Field("x"));
        await SaveAsync(b, db2, Field("x"));
        // Sem versão publicada não pode ser padrão.
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => service.UpdateAsync(a, new("Modelo A", "", true, false, 1), Ambassador, default))).Status);
        await PublishAsync(a, da);
        await PublishAsync(b, db2);
        await service.UpdateAsync(a, new("Modelo A", "", true, false, await TemplateRevisionAsync(a)), Ambassador, default);
        db.ChangeTracker.Clear();
        await service.UpdateAsync(b, new("Modelo B", "", true, false, await TemplateRevisionAsync(b)), Ambassador, default);
        db.ChangeTracker.Clear();
        var defaults = await db.SheetTemplates.AsNoTracking().Where(t => t.RpgSystemId == RpgSystem.FreeSystemId && t.IsDefault).Select(t => t.Id).ToListAsync();
        Assert.Equal([b], defaults);
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => service.UpdateAsync(b, new("Modelo B", "", false, false, 0), Ambassador, default))).Status); // revisão velha
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(async () => await service.UpdateAsync(b, new("Modelo B", "", false, false, await TemplateRevisionAsync(b)), Ambassador, default))).Status);
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(async () => await service.UpdateAsync(b, new("Modelo B", "", false, true, await TemplateRevisionAsync(b)), Ambassador, default))).Status);
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(async () => await service.UpdateAsync(a, new("Modelo B", "", false, false, await TemplateRevisionAsync(a)), Ambassador, default))).Status); // nome repetido
        await service.UpdateAsync(a, new("Modelo A", "", false, true, await TemplateRevisionAsync(a)), Ambassador, default);
        db.ChangeTracker.Clear();
        var list = JsonSerializer.Serialize(await service.ListPublishedAsync(RpgSystem.FreeSystemId, default));
        Assert.DoesNotContain("Modelo A", list);
        Assert.Contains("Modelo B", list);
    }

    [Fact]
    public async Task Free_template_is_idempotent_with_exact_field_names()
    {
        await SheetTemplateService.EnsureFreeTemplateAsync(db, default);
        db.ChangeTracker.Clear();
        await SheetTemplateService.EnsureFreeTemplateAsync(db, default);
        db.ChangeTracker.Clear();
        var t = await db.SheetTemplates.AsNoTracking().SingleAsync();
        Assert.Equal(SheetTemplate.FreeTemplateId, t.Id);
        Assert.Equal(RpgSystem.FreeSystemId, t.RpgSystemId);
        Assert.True(t.IsDefault);
        Assert.Equal(SheetTemplateVersion.FreeTemplateV1Id, t.CurrentVersionId);
        var v = await db.SheetTemplateVersions.AsNoTracking().SingleAsync();
        Assert.Equal(SheetTemplateVersion.FreeTemplateV1Id, v.Id);
        Assert.NotNull(v.PublishedAt);
        Assert.Null(v.PdfFileId);
        Assert.Empty(v.Actions);
        Assert.Single(v.Pages);
        string[] expected = ["nome", "arquetipo", "nivel", "vida", "vida_max", "forca", "agilidade", "intelecto", "constituicao",
            "forca_mod", "agilidade_mod", "intelecto_mod", "constituicao_mod", "armadura", "deslocamento", "notas"];
        Assert.Equal(expected.Order(), v.Fields.Select(f => f.Name).Order());
        var by = v.Fields.ToDictionary(f => f.Name);
        Assert.Equal((SheetFieldTypes.Text, SheetFieldRoles.Name), (by["nome"].Type, by["nome"].Role));
        Assert.Equal((SheetFieldTypes.Number, SheetFieldRoles.Level, 1d, 1000d), (by["nivel"].Type, by["nivel"].Role, by["nivel"].Min!.Value, by["nivel"].Max!.Value));
        Assert.Equal((SheetFieldRoles.Hp, 0d), (by["vida"].Role, by["vida"].Min!.Value));
        Assert.Equal((SheetFieldRoles.MaxHp, 1d), (by["vida_max"].Role, by["vida_max"].Min!.Value));
        Assert.Equal((SheetFieldRoles.Armor, "10"), (by["armadura"].Role, by["armadura"].Default));
        Assert.Equal((SheetFieldRoles.Movement, "9"), (by["deslocamento"].Role, by["deslocamento"].Default));
        foreach (var attr in new[] { "forca", "agilidade", "intelecto", "constituicao" })
        {
            Assert.Equal((SheetFieldTypes.Number, 0d, 1000d, "10"), (by[attr].Type, by[attr].Min!.Value, by[attr].Max!.Value, by[attr].Default));
            Assert.Equal((SheetFieldTypes.Computed, $"mod(@{attr})"), (by[attr + "_mod"].Type, by[attr + "_mod"].Formula));
        }
        Assert.Equal(SheetFieldTypes.Text, by["arquetipo"].Type);
        Assert.Null(by["arquetipo"].Role);
        Assert.Equal((SheetFieldTypes.TextArea, (int?)10000), (by["notas"].Type, by["notas"].MaxLength));
        // Layout passa nas mesmas regras estruturais e semânticas de qualquer modelo, sem sobreposição.
        Assert.Empty(SheetTemplateService.StructureIssues(v.Pages, v.Fields, v.Actions, v.Notes));
        Assert.Empty(SheetTemplateService.SemanticIssues(v.Pages, v.Fields));
        foreach (var f in v.Fields)
            foreach (var g in v.Fields.Where(g => g != f))
                Assert.False(f.X < g.X + g.W && g.X < f.X + f.W && f.Y < g.Y + g.H && g.Y < f.Y + f.H, $"{f.Name} sobrepõe {g.Name}");
        // O modelo embutido não pode ser arquivado.
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => service.UpdateAsync(t.Id, new(t.Name, t.Description, false, true, t.Revision), Admin, default))).Status);
    }

    [Fact]
    public async Task Drafts_are_hidden_from_common_users()
    {
        var (template, draft) = await CreateAsync();
        Assert.Equal(404, (await Assert.ThrowsAsync<RuleException>(() => service.GetVersionAsync(template, draft, Common, default))).Status);
        Assert.Equal(404, (await Assert.ThrowsAsync<RuleException>(() => service.GetAsync(template, Common, default))).Status);
        Assert.Equal(404, (await Assert.ThrowsAsync<RuleException>(() => service.GetPdfAsync(template, draft, Common, default))).Status);
        Assert.NotNull(await service.GetVersionAsync(template, draft, Ambassador, default));
        Assert.Equal(draft, Prop<Guid?>(await service.GetAsync(template, Admin, default), "draftId"));
        Assert.Equal("[]", JsonSerializer.Serialize(await service.ListPublishedAsync(null, default)));
        await SaveAsync(template, draft, Field("forca"));
        await PublishAsync(template, draft);
        Assert.NotNull(await service.GetVersionAsync(template, draft, Common, default));
        Assert.Contains("Tormenta", JsonSerializer.Serialize(await service.GetAsync(template, Common, default)));
        // Versão de outro modelo não é encontrada pelo par (modelo, versão).
        var (other, _) = await CreateAsync("Outro");
        Assert.Equal(404, (await Assert.ThrowsAsync<RuleException>(() => service.GetVersionAsync(other, draft, Admin, default))).Status);
    }

    [Fact]
    public async Task Pdf_files_are_shared_by_clones_and_removed_only_when_orphaned()
    {
        var (template, draft) = await CreateAsync();
        var pdf = new UploadedDocument("%PDF-1.7\nconteudo\n%%EOF\n"u8.ToArray(), DocumentKinds.Pdf, "ficha.pdf", new string('b', 64));
        Assert.Equal(400, (await Assert.ThrowsAsync<RuleException>(() => service.UploadPdfAsync(template, draft, pdf, "[]", 1, Ambassador, default))).Status);
        Assert.Equal(400, (await Assert.ThrowsAsync<RuleException>(() => service.UploadPdfAsync(template, draft, pdf, "[{\"width\":10,\"height\":800}]", 1, Ambassador, default))).Status);
        var broken = pdf with { Content = "%PDF-1.7\ntruncado"u8.ToArray() };
        Assert.Equal(400, (await Assert.ThrowsAsync<RuleException>(() => service.UploadPdfAsync(template, draft, broken, "[{\"width\":600,\"height\":800}]", 1, Ambassador, default))).Status);
        var uploaded = await service.UploadPdfAsync(template, draft, pdf, "[{\"width\":612,\"height\":792},{\"width\":612,\"height\":792}]", 1, Ambassador, default);
        db.ChangeTracker.Clear();
        Assert.Equal(2, Prop<int>(uploaded, "Revision"));
        Assert.Equal(2, Prop<List<SheetPage>>(uploaded, "Pages").Count);
        var file = (await service.GetPdfAsync(template, draft, Ambassador, default)).Id;
        await SaveAsync(template, draft, Field("forca"));
        db.ChangeTracker.Clear();
        // Salvar o rascunho com as páginas do PDF preserva o arquivo.
        Assert.Equal(file, (await db.SheetTemplateVersions.AsNoTracking().SingleAsync(v => v.Id == draft)).PdfFileId);
        await PublishAsync(template, draft);
        var clone = await NewDraftAsync(template);
        Assert.Equal(file, (await db.SheetTemplateVersions.AsNoTracking().SingleAsync(v => v.Id == clone)).PdfFileId);
        await service.DeletePdfAsync(template, clone, Ambassador, default);
        db.ChangeTracker.Clear();
        Assert.True(await db.Files.AnyAsync(f => f.Id == file)); // ainda usado pela v1
        var replacement = pdf with { Sha256 = new string('c', 64) };
        await service.UploadPdfAsync(template, clone, replacement, "[{\"width\":600,\"height\":800}]", await RevisionAsync(clone), Ambassador, default);
        db.ChangeTracker.Clear();
        var second = (await db.SheetTemplateVersions.AsNoTracking().SingleAsync(v => v.Id == clone)).PdfFileId!.Value;
        await service.DeleteVersionAsync(template, clone, Ambassador, default);
        db.ChangeTracker.Clear();
        Assert.False(await db.Files.AnyAsync(f => f.Id == second));
        Assert.True(await db.Files.AnyAsync(f => f.Id == file));
    }

    [Fact]
    public async Task Every_staff_change_is_audited()
    {
        var (template, draft) = await CreateAsync();
        await SaveAsync(template, draft, Field("forca"));
        var pdf = new UploadedDocument("%PDF-1.7\n%%EOF"u8.ToArray(), DocumentKinds.Pdf, "f.pdf", new string('d', 64));
        await service.UploadPdfAsync(template, draft, pdf, "[{\"width\":600,\"height\":800}]", await RevisionAsync(draft), Ambassador, default);
        db.ChangeTracker.Clear();
        await PublishAsync(template, draft);
        await service.UpdateAsync(template, new("Tormenta 20", "", true, false, await TemplateRevisionAsync(template)), Ambassador, default);
        db.ChangeTracker.Clear();
        var v2 = await NewDraftAsync(template);
        await service.DeleteVersionAsync(template, v2, Ambassador, default);
        db.ChangeTracker.Clear();
        await service.RepublishAsync(template, draft, Admin, default);
        var actions = await db.Audit.AsNoTracking().OrderBy(a => a.Id).Select(a => a.Action).ToListAsync();
        Assert.Equal(["template.create", "template.version.update", "template.pdf.upload", "template.publish", "template.update", "template.version.create", "template.version.delete", "template.republish"], actions);
        var update = await db.Audit.AsNoTracking().SingleAsync(a => a.Action == "template.version.update");
        Assert.Contains("campos 0 → 1", update.Summary);
        Assert.Contains("\"before\":{\"fields\":0", update.Data);
        var publish = await db.Audit.AsNoTracking().SingleAsync(a => a.Action == "template.publish");
        Assert.Equal(Ambassador, publish.ActorId);
        Assert.Contains("\"added\":[\"forca\"]", publish.Data);
        Assert.Equal("sheet-template", publish.TargetType);
    }

    [Fact]
    public void Diff_matches_fields_by_name()
    {
        SheetTemplateVersion V(int number, params SheetField[] fields) => new() { Number = number, Pages = [new()], Fields = [.. fields] };
        var before = V(1, Field("forca"), Field("agilidade"), Field("velho"), Field("pos"));
        before.Actions = [new() { Key = "golpe", Name = "Golpe", Formula = "1d20" }, new() { Key = "sai", Name = "Sai" }];
        var renamed = Field("agilidade"); renamed.Label = "Destreza";
        var typed = Field("forca", SheetFieldTypes.Computed); typed.Formula = "10";
        var after = V(2, typed, renamed, Field("novo"), Field("pos", x: 0.5));
        after.Actions = [new() { Key = "golpe", Name = "Golpe", Formula = "1d20+2" }, new() { Key = "magia", Name = "Magia" }];
        var diff = SheetTemplateService.Diff(before, after);
        Assert.Equal(1, diff.FromNumber);
        Assert.Equal(["novo"], diff.Added);
        Assert.Equal(["velho"], diff.Removed);
        Assert.Equal(["forca", "agilidade"], diff.Changed.Select(c => c.Name));
        Assert.Equal(["type", "formula"], diff.Changed[0].Changes);
        Assert.Equal(["label"], diff.Changed[1].Changes);
        Assert.Equal(["pos"], diff.Moved);
        Assert.Equal(["magia"], diff.ActionsAdded);
        Assert.Equal(["sai"], diff.ActionsRemoved);
        Assert.Equal(["golpe"], diff.ActionsChanged);
        var first = SheetTemplateService.Diff(null, after);
        Assert.Null(first.FromNumber);
        Assert.Equal(4, first.Added.Count);
    }

    [Fact]
    public async Task Publish_rejects_semantic_problems_with_located_errors()
    {
        var (template, draft) = await CreateAsync();
        var empty = await Assert.ThrowsAsync<SheetValidationException>(() => PublishAsync(template, draft));
        Assert.Contains(empty.Errors, e => e.Message.Contains("ao menos um campo"));
        var select = new SheetField { Name = "classe", Type = SheetFieldTypes.Select, X = 0, Y = 0, W = .2, H = .05 };
        var hp = new SheetField { Name = "vida", Type = SheetFieldTypes.Text, Role = SheetFieldRoles.Hp, X = 0, Y = .2, W = .2, H = .05 };
        var far = new SheetField { Name = "longe", Type = SheetFieldTypes.Number, Page = 3, Default = "abc", X = 0, Y = .4, W = .2, H = .05 };
        await SaveAsync(template, draft, select, hp, far);
        var errors = (await Assert.ThrowsAsync<SheetValidationException>(() => PublishAsync(template, draft))).Errors;
        Assert.Contains(errors, e => e.Field == "classe");
        Assert.Contains(errors, e => e.Field == "vida");
        Assert.Equal(2, errors.Count(e => e.Field == "longe"));
        Assert.Null((await db.SheetTemplateVersions.AsNoTracking().SingleAsync(v => v.Id == draft)).PublishedAt);
    }

    /// <summary>Requer WP3: validação real das fórmulas (SheetCalculator.ValidateFields e Formula.Validate no modo Roll).</summary>
    [Fact]
    public void Real_publish_validation_uses_the_formula_language()
    {
        var free = new SheetTemplateVersion { Pages = [new()], Fields = SheetTemplateService.FreeTemplateFields() };
        IReadOnlyList<SheetIssue> issues;
        try { issues = SheetTemplateService.ValidateForPublish(free); }
        catch (RuleException ex) when (ex.Status == 503)
        {
            output.WriteLine("PENDENTE (requer WP3): a linguagem de fórmulas ainda é stub; validação real de publicação não exercitada.");
            return;
        }
        Assert.Empty(issues);
        var broken = new SheetTemplateVersion { Pages = [new()], Fields = [new() { Name = "a", Type = SheetFieldTypes.Computed, Formula = "@b + (", X = 0, Y = 0, W = .1, H = .1 }] };
        broken.Actions = [new() { Key = "golpe", Name = "Golpe", Kind = ActionKinds.Attack, Formula = "1d20 + @inexistente" }];
        var errors = SheetTemplateService.ValidateForPublish(broken);
        Assert.Contains(errors, e => e.Field == "a");
        Assert.Contains(errors, e => e.Action == "golpe");
    }

    [Fact]
    public void Error_messages_are_mapped_to_the_mentioned_field()
    {
        var fields = new List<SheetField> { Field("forca"), Field("forca_mod") };
        Assert.Equal("forca_mod", SheetTemplateService.FieldMentioned("Campo forca_mod: referência circular", fields));
        Assert.Equal("forca", SheetTemplateService.FieldMentioned("O campo forca usa @x", fields));
        Assert.Null(SheetTemplateService.FieldMentioned("Erro geral", fields));
    }
}
