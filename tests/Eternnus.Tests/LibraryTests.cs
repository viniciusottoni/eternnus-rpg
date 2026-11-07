using System.Text;
using System.Text.Json;
using Eternnus.Web;
using Microsoft.AspNetCore.Http;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Eternnus.Tests;

/// <summary>Regras da biblioteca em SQLite. Bloqueio de linha, multipart, limites HTTP e cabeçalhos são cobertos por tests/library.mjs em PostgreSQL.</summary>
public sealed class LibraryTests : IAsyncLifetime
{
    sealed class CleanScanner : IDocumentScanner
    {
        public int Scans { get; private set; }
        public Task ScanAsync(byte[] content, CancellationToken ct) { Scans++; return Task.CompletedTask; }
    }

    readonly SqliteConnection connection = new("Data Source=:memory:");
    GameDb db = null!;
    LibraryService service = null!;
    readonly CleanScanner scanner = new();
    const string Admin = "admin", Ambassador = "ambassador", Common = "common";
    static readonly Guid Tormenta = Guid.Parse("11111111-1111-4111-8111-111111111111");
    static readonly byte[] Pdf = Encoding.ASCII.GetBytes("%PDF-1.4\n1 0 obj << >> endobj\n%%EOF\n");
    static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13];

    public async Task InitializeAsync()
    {
        await connection.OpenAsync();
        db = new GameDb(new DbContextOptionsBuilder<GameDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        foreach (var (id, role, name) in new[] { (Admin, PlatformRoles.Admin, "Ada"), (Ambassador, PlatformRoles.Ambassador, "Bento"), (Common, PlatformRoles.Common, "Caio") })
            db.Users.Add(new AppUser { Id = id, UserName = id, NormalizedEmail = id.ToUpperInvariant(), EmailConfirmed = true, DisplayName = name, Role = role });
        db.RpgSystems.Add(new RpgSystem { Id = Tormenta, Name = "Tormenta20", Slug = "tormenta20" });
        await db.SaveChangesAsync();
        service = new LibraryService(db, new AuditService(db));
    }
    public async Task DisposeAsync() { await db.DisposeAsync(); await connection.DisposeAsync(); }

    static UploadedDocument Doc(byte[] content, string type, string name = "arquivo") =>
        new(content, type, DocumentFiles.SafeFileName(name, type), Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(content)));
    static LibraryMetadata Meta(string title = "Manual do Aventureiro", string category = LibraryCategories.Rules, Guid? system = null, string description = "Regras básicas") => new(title, description, category, system);
    static int Status(RuleException e) => e.Status;
    async Task<LibraryItemView> CreateAsync(string title = "Manual do Aventureiro", byte[]? content = null) =>
        await service.CreateAsync(Ambassador, Meta(title, system: Tormenta), Doc(content ?? Pdf, DocumentKinds.Pdf, "manual.pdf"), default);

    [Theory]
    [InlineData("../../etc/passwd", DocumentKinds.Pdf, "passwd.pdf")]
    [InlineData("C:\\Users\\Ana\\Mapa da Cripta.PNG", DocumentKinds.Png, "Mapa da Cripta.png")]
    [InlineData("relatorio.pdf.exe", DocumentKinds.Pdf, "relatorio.pdf.pdf")]
    [InlineData("<script>a\u0007b;c%.pdf", DocumentKinds.Pdf, "scriptabc.pdf")]
    [InlineData("   ...   ", DocumentKinds.Jpeg, "arquivo.jpg")]
    [InlineData(null, DocumentKinds.WebP, "arquivo.webp")]
    public void File_names_are_sanitized_and_follow_the_real_type(string? original, string type, string expected) =>
        Assert.Equal(expected, DocumentFiles.SafeFileName(original, type));

    [Fact]
    public void Long_file_names_are_truncated_keeping_the_extension()
    {
        var name = DocumentFiles.SafeFileName(new string('a', 400) + ".pdf", DocumentKinds.Pdf);
        Assert.Equal(160, name.Length);
        Assert.EndsWith(".pdf", name);
    }

    [Fact]
    public void Content_type_comes_from_the_signature_not_from_the_name()
    {
        Assert.Equal(DocumentKinds.Pdf, DocumentFiles.Sniff(Pdf));
        Assert.Equal(DocumentKinds.Png, DocumentFiles.Sniff(Png));
        Assert.Equal(DocumentKinds.Jpeg, DocumentFiles.Sniff(new byte[] { 0xFF, 0xD8, 0xFF, 0xE0 }));
        Assert.Equal(DocumentKinds.WebP, DocumentFiles.Sniff(Encoding.ASCII.GetBytes("RIFF\0\0\0\0WEBPVP8 ")));
        Assert.Null(DocumentFiles.Sniff(Encoding.ASCII.GetBytes("<!DOCTYPE html><script>alert(1)</script>")));
        Assert.Null(DocumentFiles.Sniff(Encoding.ASCII.GetBytes("GIF89a")));
        Assert.Null(DocumentFiles.Sniff([]));
    }

    [Fact]
    public async Task Fake_pdf_with_html_is_rejected_with_415_before_the_antivirus()
    {
        var html = Encoding.ASCII.GetBytes("<html><body><script>alert(document.cookie)</script></body></html>");
        await using var stream = new MemoryStream(html);
        var file = new FormFile(stream, 0, html.Length, "file", "manual.pdf");
        var files = new DocumentFiles(scanner);
        Assert.Equal(415, Status(await Assert.ThrowsAsync<RuleException>(() => files.ReadAsync(file, DocumentKinds.Library, default))));
        Assert.Equal(0, scanner.Scans);
        await using var real = new MemoryStream(Pdf);
        var ok = await files.ReadAsync(new FormFile(real, 0, Pdf.Length, "file", "dir/Livro <1>.png"), DocumentKinds.Library, default);
        Assert.Equal(DocumentKinds.Pdf, ok.ContentType);
        Assert.Equal("Livro 1.pdf", ok.FileName);
        Assert.Equal(64, ok.Sha256.Length);
        Assert.Equal(1, scanner.Scans);
    }

    [Theory]
    [InlineData(DocumentKinds.Pdf, true, "", true)]
    [InlineData(DocumentKinds.Pdf, true, "empty", true)]
    [InlineData(DocumentKinds.Pdf, true, "document", false)]
    [InlineData(DocumentKinds.Pdf, true, "iframe", false)]
    [InlineData(DocumentKinds.Pdf, true, "embed", false)]
    [InlineData(DocumentKinds.Pdf, false, "empty", false)]
    [InlineData(DocumentKinds.Png, true, "image", true)]
    [InlineData(DocumentKinds.WebP, false, "image", false)]
    public void Inline_is_only_for_images_and_the_pdf_viewer_fetch(string type, bool requested, string fetchDest, bool expected)
    {
        var http = new DefaultHttpContext();
        if (fetchDest.Length > 0) http.Request.Headers["Sec-Fetch-Dest"] = fetchDest;
        Assert.Equal(expected, LibraryEndpoints.Inline(http.Request, type, requested));
    }

    [Theory]
    [InlineData("", LibraryCategories.Rules, "")]
    [InlineData("   ", LibraryCategories.Rules, "")]
    [InlineData("Título", "spells", "")]
    [InlineData("Título", "", "")]
    public void Invalid_metadata_is_rejected(string title, string category, string description) =>
        Assert.Equal(400, Status(Assert.Throws<RuleException>(() => LibraryService.ValidateFields(new(title, description, category, null)))));

    [Fact]
    public void Metadata_limits_are_enforced_and_control_characters_removed()
    {
        Assert.Throws<RuleException>(() => LibraryService.ValidateFields(new(new string('x', 121), "", LibraryCategories.Map, null)));
        Assert.Throws<RuleException>(() => LibraryService.ValidateFields(new("Ok", new string('x', 2001), LibraryCategories.Map, null)));
        var ok = LibraryService.ValidateFields(new("  Mapa\u0000 da\u001b cripta  ", "Linha 1\r\nLinha\u0007 2  ", LibraryCategories.Map, null));
        Assert.Equal("Mapa da cripta", ok.Title);
        Assert.Equal("Linha 1\nLinha 2", ok.Description);
        Assert.Equal(new string('x', 120), LibraryService.ValidateFields(new(new string('x', 120), new string('y', 2000), LibraryCategories.Art, null)).Title);
    }

    [Fact]
    public async Task Only_staff_publish_and_the_system_must_exist()
    {
        Assert.Equal(403, Status(await Assert.ThrowsAsync<RuleException>(() => service.CreateAsync(Common, Meta(), Doc(Pdf, DocumentKinds.Pdf), default))));
        Assert.Equal(400, Status(await Assert.ThrowsAsync<RuleException>(() => service.CreateAsync(Ambassador, Meta(system: Guid.NewGuid()), Doc(Pdf, DocumentKinds.Pdf), default))));
        var item = await CreateAsync();
        Assert.Equal("Tormenta20", item.System);
        Assert.Equal("Bento", item.CreatedBy);
        Assert.Equal(DocumentKinds.Pdf, item.ContentType);
        Assert.Equal(Pdf.Length, item.Size);
        Assert.Equal("manual.pdf", item.FileName);
        var entry = await db.Audit.SingleAsync();
        Assert.Equal((Ambassador, LibraryService.ActionUpload, "library", item.Id.ToString()), (entry.ActorId, entry.Action, entry.TargetType, entry.TargetId));
        Assert.DoesNotContain("@", entry.Data);
    }

    [Fact]
    public async Task Identical_content_reuses_the_stored_file()
    {
        var first = await CreateAsync("Primeiro");
        var second = await CreateAsync("Segundo");
        Assert.Equal(1, await db.Files.CountAsync());
        Assert.Equal(await db.Library.Where(i => i.Id == first.Id).Select(i => i.FileId).SingleAsync(), await db.Library.Where(i => i.Id == second.Id).Select(i => i.FileId).SingleAsync());
        Assert.Contains("\"deduplicated\":true", (await db.Audit.OrderBy(a => a.Id).LastAsync()).Data);
        await service.CreateAsync(Ambassador, Meta("Imagem"), Doc(Png, DocumentKinds.Png), default);
        Assert.Equal(2, await db.Files.CountAsync());
    }

    [Fact]
    public async Task Listing_filters_paginates_and_hides_deleted_items()
    {
        var pdf = await CreateAsync("Regras de Arton");
        await service.CreateAsync(Admin, Meta("Mapa geral", LibraryCategories.Map), Doc(Png, DocumentKinds.Png, "mapa.png"), default);
        static List<LibraryItemView> Items(object page) => (List<LibraryItemView>)page.GetType().GetProperty("items")!.GetValue(page)!;
        Assert.Equal(2, Items(await service.ListAsync(Common, new(null, null, null, null), default)).Count);
        Assert.Equal("Mapa geral", Items(await service.ListAsync(Common, new(null, null, null, "image"), default)).Single().Title);
        Assert.Equal("Regras de Arton", Items(await service.ListAsync(Common, new("ARTON", null, null, null), default)).Single().Title);
        Assert.Equal("Mapa geral", Items(await service.ListAsync(Common, new(null, "none", null, null), default)).Single().Title);
        Assert.Equal("Regras de Arton", Items(await service.ListAsync(Common, new(null, Tormenta.ToString(), LibraryCategories.Rules, "pdf"), default)).Single().Title);
        Assert.Single(Items(await service.ListAsync(Common, new(null, null, null, null, 2, 1), default)));
        Assert.Equal(400, Status(await Assert.ThrowsAsync<RuleException>(() => service.ListAsync(Common, new(null, "x", null, null), default))));
        Assert.Equal(400, Status(await Assert.ThrowsAsync<RuleException>(() => service.ListAsync(Common, new(null, null, "spells", null), default))));
        Assert.Equal(400, Status(await Assert.ThrowsAsync<RuleException>(() => service.ListAsync(Common, new(null, null, null, "exe"), default))));
        Assert.Equal(403, Status(await Assert.ThrowsAsync<RuleException>(() => service.ListAsync(Common, new(null, null, null, null, Deleted: true), default))));

        await service.DeleteAsync(pdf.Id, Ambassador, new("Duplicado", null), default);
        Assert.Single(Items(await service.ListAsync(Common, new(null, null, null, null), default)));
        Assert.Equal(404, Status(await Assert.ThrowsAsync<RuleException>(() => service.GetAsync(pdf.Id, Common, default))));
        Assert.Equal(404, Status(await Assert.ThrowsAsync<RuleException>(() => service.FileAsync(pdf.Id, Common, default))));
        Assert.Equal(404, Status(await Assert.ThrowsAsync<RuleException>(() => service.MarkDownloadedAsync(pdf.Id, default))));
        Assert.Equal(pdf.Id, Items(await service.ListAsync(Ambassador, new(null, null, null, null, Deleted: true), default)).Single().Id);
        Assert.NotNull((await service.GetAsync(pdf.Id, Ambassador, default)).DeletedAt);
    }

    [Fact]
    public async Task Edits_need_the_current_revision_and_are_audited()
    {
        var item = await CreateAsync();
        Assert.Equal(403, Status(await Assert.ThrowsAsync<RuleException>(() => service.UpdateAsync(item.Id, Common, new("X", "", LibraryCategories.Rules, null, item.Revision), default))));
        var updated = await service.UpdateAsync(item.Id, Ambassador, new("Manual revisado", "Nova descrição", LibraryCategories.Adventure, null, item.Revision), default);
        Assert.Equal(item.Revision + 1, updated.Revision);
        Assert.Null(updated.SystemId);
        Assert.Equal(409, Status(await Assert.ThrowsAsync<RuleException>(() => service.UpdateAsync(item.Id, Ambassador, new("Outra", "", LibraryCategories.Rules, null, item.Revision), default))));
        var entry = await db.Audit.Where(a => a.Action == LibraryService.ActionUpdate).SingleAsync();
        using var data = JsonDocument.Parse(entry.Data);
        Assert.Equal("Manual do Aventureiro", data.RootElement.GetProperty("before").GetProperty("title").GetString());
        Assert.Equal("Manual revisado", data.RootElement.GetProperty("after").GetProperty("title").GetString());
        await service.MarkDownloadedAsync(item.Id, default);
        var afterDownload = await service.GetAsync(item.Id, Common, default);
        Assert.Equal((1, updated.Revision), (afterDownload.Downloads, afterDownload.Revision));
    }

    [Fact]
    public async Task Replacing_keeps_the_previous_file_and_only_admins_revert_entries_of_the_same_item()
    {
        var item = await CreateAsync();
        var other = await CreateAsync("Outro material", Encoding.ASCII.GetBytes("%PDF-1.7\nOutro\n%%EOF"));
        var originalFile = await db.Library.Where(i => i.Id == item.Id).Select(i => i.FileId).SingleAsync();
        var replaced = await service.ReplaceFileAsync(item.Id, Ambassador, item.Revision, Doc(Png, DocumentKinds.Png, "nova capa.png"), default);
        Assert.Equal(("nova capa.png", DocumentKinds.Png), (replaced.FileName, replaced.ContentType));
        Assert.True(await db.Files.AnyAsync(f => f.Id == originalFile));
        Assert.Equal(409, Status(await Assert.ThrowsAsync<RuleException>(() => service.ReplaceFileAsync(item.Id, Ambassador, item.Revision, Doc(Pdf, DocumentKinds.Pdf), default))));
        var replace = await db.Audit.Where(a => a.Action == LibraryService.ActionReplace).SingleAsync();
        using (var data = JsonDocument.Parse(replace.Data))
        {
            Assert.Equal(originalFile, data.RootElement.GetProperty("previousFileId").GetGuid());
            Assert.Equal("manual.pdf", data.RootElement.GetProperty("previousFileName").GetString());
        }

        Assert.Equal(403, Status(await Assert.ThrowsAsync<RuleException>(() => service.RevertAsync(item.Id, Ambassador, replace.Id, default))));
        // Entrada de outro item não pode ser aplicada a este.
        Assert.Equal(404, Status(await Assert.ThrowsAsync<RuleException>(() => service.RevertAsync(other.Id, Admin, replace.Id, default))));
        Assert.Equal(404, Status(await Assert.ThrowsAsync<RuleException>(() => service.RevertAsync(item.Id, Admin, 999_999, default))));
        var upload = await db.Audit.Where(a => a.Action == LibraryService.ActionUpload && a.TargetId == item.Id.ToString()).SingleAsync();
        Assert.Equal(400, Status(await Assert.ThrowsAsync<RuleException>(() => service.RevertAsync(item.Id, Admin, upload.Id, default))));

        var reverted = await service.RevertAsync(item.Id, Admin, replace.Id, default);
        Assert.Equal(("manual.pdf", DocumentKinds.Pdf), (reverted.FileName, reverted.ContentType));
        Assert.Equal(originalFile, await db.Library.Where(i => i.Id == item.Id).Select(i => i.FileId).SingleAsync());
        var revert = await db.Audit.Where(a => a.Action == LibraryService.ActionRevert).SingleAsync();
        Assert.Equal((Admin, item.Id.ToString()), (revert.ActorId, revert.TargetId));
        Assert.Contains($"\"auditId\":{replace.Id}", revert.Data);
    }

    [Fact]
    public async Task Admin_reverts_metadata_to_the_before_state()
    {
        var item = await CreateAsync();
        await service.UpdateAsync(item.Id, Ambassador, new("Título vandalizado", "", LibraryCategories.Other, null, item.Revision), default);
        var update = await db.Audit.Where(a => a.Action == LibraryService.ActionUpdate).SingleAsync();
        var reverted = await service.RevertAsync(item.Id, Admin, update.Id, default);
        Assert.Equal(("Manual do Aventureiro", "Regras básicas", LibraryCategories.Rules, (Guid?)Tormenta), (reverted.Title, reverted.Description, reverted.Category, reverted.SystemId));
        Assert.Equal(item.Revision + 2, reverted.Revision);
    }

    [Fact]
    public async Task Admin_restores_deleted_items_and_history_lists_every_action()
    {
        var item = await CreateAsync();
        Assert.Equal(403, Status(await Assert.ThrowsAsync<RuleException>(() => service.DeleteAsync(item.Id, Common, null, default))));
        Assert.Equal(409, Status(await Assert.ThrowsAsync<RuleException>(() => service.RestoreAsync(item.Id, Admin, default))));
        Assert.Equal(400, Status(await Assert.ThrowsAsync<RuleException>(() => service.DeleteAsync(item.Id, Ambassador, new(new string('x', 301), null), default))));
        await service.DeleteAsync(item.Id, Ambassador, new("Conteúdo protegido", item.Revision), default);
        Assert.Equal(409, Status(await Assert.ThrowsAsync<RuleException>(() => service.DeleteAsync(item.Id, Ambassador, null, default))));
        Assert.Equal(409, Status(await Assert.ThrowsAsync<RuleException>(() => service.UpdateAsync(item.Id, Ambassador, new("X", "", LibraryCategories.Rules, null, item.Revision + 1), default))));
        Assert.Equal(403, Status(await Assert.ThrowsAsync<RuleException>(() => service.RestoreAsync(item.Id, Ambassador, default))));
        var restored = await service.RestoreAsync(item.Id, Admin, default);
        Assert.Null(restored.DeletedAt);
        Assert.Equal("Manual do Aventureiro", (await service.GetAsync(item.Id, Common, default)).Title);

        Assert.Equal(403, Status(await Assert.ThrowsAsync<RuleException>(() => service.HistoryAsync(item.Id, Common, 1, default))));
        var history = JsonSerializer.Serialize(await service.HistoryAsync(item.Id, Ambassador, 1, default), new JsonSerializerOptions(JsonSerializerDefaults.Web));
        using var doc = JsonDocument.Parse(history);
        var actions = doc.RootElement.GetProperty("items").EnumerateArray().Select(e => (e.GetProperty("action").GetString(), e.GetProperty("actor").GetString())).ToList();
        Assert.Equal([(LibraryService.ActionRestore, "Ada"), (LibraryService.ActionDelete, "Bento"), (LibraryService.ActionUpload, "Bento")], actions);
        Assert.Contains(doc.RootElement.GetProperty("items").EnumerateArray(), e => e.GetProperty("summary").GetString()!.Contains("Conteúdo protegido"));
        Assert.Equal(3, doc.RootElement.GetProperty("total").GetInt32());
    }
}
