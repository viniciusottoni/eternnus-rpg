using System.Text;
using System.Text.Json;
using Eternnus.Web;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Tests;

/// <summary>Tabela única de sessões, busca geral, NPCs compartilhados e importação em lote (ADR-061).</summary>
public sealed class SessionLogTests : IAsyncLifetime
{
    readonly SqliteConnection connection = new("Data Source=:memory:");
    GameDb db = null!;
    WorkspaceService service = null!;
    readonly Campaign campaign = new() { OwnerId = "master", Name = "Eternnus", Description = "No princípio havia três entidades." };
    static JsonElement Json(object o) => JsonSerializer.SerializeToElement(o, new JsonSerializerOptions(JsonSerializerDefaults.Web));

    public async Task InitializeAsync()
    {
        await connection.OpenAsync(); db = new(new DbContextOptionsBuilder<GameDb>().UseSqlite(connection).Options); await db.Database.EnsureCreatedAsync();
        foreach (var id in new[] { "master", "player", "outsider" }) db.Users.Add(new AppUser { Id = id, NormalizedEmail = id.ToUpperInvariant() });
        db.AddRange(campaign, new Member { CampaignId = campaign.Id, UserId = "player" });
        await db.SaveChangesAsync(); service = new(db);
    }
    public async Task DisposeAsync() { await db.DisposeAsync(); await connection.DisposeAsync(); }

    async Task<StoryChapter> Seed()
    {
        var act = await service.SaveChapter(campaign.Id, null, "master", new("Trevas", "act"), default);
        db.AddRange(
            new GameSession { CampaignId = campaign.Id, Number = 3, Title = "A cripta", Recap = "Os heróis enfrentaram um Goblin.", RecapPublishedAt = DateTime.UtcNow, EndedAt = DateTime.UtcNow, ChapterId = act.Id, Objective = "Segredo do mestre: o rei trai." },
            new GameSession { CampaignId = campaign.Id, Number = 4, Title = "Rascunho", Recap = "Ainda não publicado goblin", EndedAt = DateTime.UtcNow });
        await db.SaveChangesAsync();
        await service.SavePast(campaign.Id, null, "master", new(1, "Blackstones", "Chegada.", Published: true, ChapterId: act.Id, Scenes: [new("Floresta", "Uma lasca de pedra negra.")]), default);
        await service.SavePast(campaign.Id, null, "master", new(2, "Rosered", "Privado.", Published: false), default);
        return act;
    }

    [Fact]
    public async Task Log_merges_both_sources_and_players_only_see_published()
    {
        var act = await Seed();
        var master = Json(await service.Log(campaign.Id, "master", null, null, null, 1, default));
        Assert.Equal(4, master.GetProperty("total").GetInt32());
        Assert.Equal([4, 3, 2, 1], master.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("number").GetInt32()));
        Assert.Equal("Trevas", master.GetProperty("items")[1].GetProperty("chapterTitle").GetString());
        Assert.Equal("past", master.GetProperty("items")[3].GetProperty("source").GetString());
        var player = Json(await service.Log(campaign.Id, "player", null, null, null, 1, default));
        Assert.Equal([3, 1], player.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("number").GetInt32()));
        Assert.Single(player.GetProperty("chapters").EnumerateArray());
        await Assert.ThrowsAsync<RuleException>(() => service.Log(campaign.Id, "outsider", null, null, null, 1, default));
        // Filtros por capítulo, avulsas e origem.
        Assert.Equal(2, Json(await service.Log(campaign.Id, "master", null, act.Id.ToString(), null, 1, default)).GetProperty("total").GetInt32());
        Assert.Equal(2, Json(await service.Log(campaign.Id, "master", null, "none", null, 1, default)).GetProperty("total").GetInt32());
        Assert.Equal(2, Json(await service.Log(campaign.Id, "master", null, null, "past", 1, default)).GetProperty("total").GetInt32());
        Assert.Equal(400, (await Assert.ThrowsAsync<RuleException>(() => service.Log(campaign.Id, "master", null, null, "outra", 1, default))).Status);
    }

    [Fact]
    public async Task Log_search_covers_recaps_and_scenes_without_leaking_private_text()
    {
        await Seed();
        var player = Json(await service.Log(campaign.Id, "player", "goblin", null, null, 1, default));
        Assert.Equal(1, player.GetProperty("total").GetInt32());
        Assert.Contains("Goblin", player.GetProperty("items")[0].GetProperty("excerpt").GetString());
        Assert.Equal(1, Json(await service.Log(campaign.Id, "player", "pedra negra", null, null, 1, default)).GetProperty("total").GetInt32());
        Assert.Equal(0, Json(await service.Log(campaign.Id, "player", "rei trai", null, null, 1, default)).GetProperty("total").GetInt32());
        Assert.Equal(1, Json(await service.Log(campaign.Id, "master", "rei trai", null, null, 1, default)).GetProperty("total").GetInt32());
        Assert.Equal(0, Json(await service.Log(campaign.Id, "player", "100%", null, null, 1, default)).GetProperty("total").GetInt32());
        Assert.Equal(400, (await Assert.ThrowsAsync<RuleException>(() => service.Log(campaign.Id, "player", "x", null, null, 1, default))).Status);
        var live = await db.Sessions.SingleAsync(s => s.Number == 3);
        var entry = Json(await service.LogEntry(campaign.Id, SessionLogSources.Key("eternnus", live.Id), "player", default));
        Assert.Equal(JsonValueKind.Null, entry.GetProperty("objective").ValueKind);
        var draft = await db.Sessions.SingleAsync(s => s.Number == 4);
        Assert.Equal(404, (await Assert.ThrowsAsync<RuleException>(() => service.LogEntry(campaign.Id, SessionLogSources.Key("eternnus", draft.Id), "player", default))).Status);
        Assert.Equal(404, (await Assert.ThrowsAsync<RuleException>(() => service.LogEntry(campaign.Id, "../" + draft.Id, "master", default))).Status);
    }

    [Fact]
    public async Task Global_search_respects_each_source_visibility()
    {
        await Seed();
        await service.Save(campaign.Id, null, "master", new("Goblins do norte", "Tribo goblin.", "faction", "table"), default);
        await service.Save(campaign.Id, null, "master", new("Plano secreto", "O goblin rei.", "faction", "self"), default);
        db.AddRange(new MasterCharacter { CampaignId = campaign.Id, Name = "Grak", Summary = "Chefe goblin", SharedWithPlayers = true },
            new MasterCharacter { CampaignId = campaign.Id, Name = "Vulto", Summary = "Espião goblin" });
        await db.SaveChangesAsync();
        var player = Json(await service.Search(campaign.Id, "player", "goblin", default)).GetProperty("items").EnumerateArray().Select(i => i.GetProperty("title").GetString()).ToList();
        Assert.Contains("Goblins do norte", player); Assert.Contains("Grak", player); Assert.Contains("Sessão 03 — A cripta", player);
        Assert.DoesNotContain("Plano secreto", player); Assert.DoesNotContain("Vulto", player); Assert.DoesNotContain("Sessão 04 — Rascunho", player);
        var master = Json(await service.Search(campaign.Id, "master", "goblin", default)).GetProperty("items").EnumerateArray().Select(i => i.GetProperty("route").GetString()).ToList();
        Assert.Contains($"campaign/{campaign.Id:D}/prep", master);
        var premise = Json(await service.Search(campaign.Id, "player", "entidades", default)).GetProperty("items")[0];
        Assert.Equal($"campaign/{campaign.Id:D}/overview/premise", premise.GetProperty("route").GetString());
    }

    [Fact]
    public void Csv_reader_handles_quotes_line_breaks_and_line_numbers()
    {
        var rows = CsvTable.Parse("a;b\r\n\"x;1\";\"linha 1\nlinha 2 \"\"citada\"\"\"\r\n\r\n3;4", 10);
        Assert.Equal(3, rows.Count);
        Assert.Equal(["x;1", "linha 1\nlinha 2 \"citada\""], rows[1].Cells);
        Assert.Equal(2, rows[1].Line); Assert.Equal(5, rows[2].Line);
        Assert.Equal(400, Assert.Throws<RuleException>(() => CsvTable.Parse("a;b\n\"aberta;1", 10)).Status);
        Assert.Equal(400, Assert.Throws<RuleException>(() => CsvTable.Parse("a\n1\n2\n3", 3)).Status);
    }

    [Fact]
    public void Import_decoding_rejects_binary_and_control_characters_and_reads_windows_1252()
    {
        Assert.Equal(400, Assert.Throws<RuleException>(() => SessionImportFormat.Decode([0x50, 0x4B, 0x03, 0x04, 0x00])).Status);
        Assert.Equal(400, Assert.Throws<RuleException>(() => SessionImportFormat.Decode(Encoding.UTF8.GetBytes("numero;titulo\n1;a\u0007"))).Status);
        Assert.Equal(400, Assert.Throws<RuleException>(() => SessionImportFormat.Decode(Encoding.UTF8.GetBytes("numero;titulo\n1;a‮b"))).Status);
        Assert.Equal(413, Assert.Throws<RuleException>(() => SessionImportFormat.Decode(new byte[SessionImportFormat.MaxBytes + 1])).Status);
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
        Assert.Equal("numero;titulo\n1;Ação", SessionImportFormat.Decode(Encoding.GetEncoding(1252).GetBytes("numero;titulo\n1;Ação")));
    }

    [Fact]
    public async Task Import_previews_validates_and_writes_all_or_nothing()
    {
        await service.SavePast(campaign.Id, null, "master", new(7, "Existente", ""), default);
        var existing = await service.SaveChapter(campaign.Id, null, "master", new("Trevas", "act"), default);
        // O modelo vem com exemplos que precisam ser apagados.
        var template = Json(await service.ImportSessions(campaign.Id, "master", SessionImportFormat.Template(), false, default));
        Assert.False(template.GetProperty("ready").GetBoolean());
        Assert.Equal(3, template.GetProperty("errors").GetArrayLength());
        var csv = "tipo_capitulo;capitulo;resumo_capitulo;numero;titulo;data;publicado;resumo;cena_1_titulo;cena_1_texto\n"
            + "ato;trevas;;1;Blackstones;13/11/2019;sim;\"=HYPERLINK(\"\"x\"\")\";Floresta;Goblins\n"
            + "arco;Fogo;Novo arco;;;;;;;\n"
            + ";;;2;<script>alert(1)</script>;;não;;;\n";
        var bytes = Encoding.UTF8.GetBytes(csv);
        Assert.Equal(403, (await Assert.ThrowsAsync<RuleException>(() => service.ImportSessions(campaign.Id, "player", bytes, false, default))).Status);
        var preview = Json(await service.ImportSessions(campaign.Id, "master", bytes, false, default));
        Assert.True(preview.GetProperty("ready").GetBoolean());
        Assert.Equal(1, preview.GetProperty("newChapters").GetInt32());
        Assert.Equal(0, await db.Set<PastSession>().CountAsync(p => p.Number == 1));
        await service.ImportSessions(campaign.Id, "master", bytes, true, default);
        var imported = await db.Set<PastSession>().AsNoTracking().OrderBy(p => p.Number).ToListAsync();
        Assert.Equal([1, 2, 7], imported.Select(p => p.Number));
        Assert.Equal(existing.Id, imported[0].ChapterId);
        Assert.Equal("=HYPERLINK(\"x\")", imported[0].Summary);
        Assert.Equal("<script>alert(1)</script>", imported[1].Title);
        Assert.Null(imported[1].ChapterId);
        Assert.Equal(2, await db.Set<StoryChapter>().CountAsync());
        // Número repetido no banco ou no arquivo: nada é gravado.
        var again = Encoding.UTF8.GetBytes("numero;titulo\n7;Duplicada\n8;Nova\n8;Repetida\n9;Data;\n");
        var bad = Json(await service.ImportSessions(campaign.Id, "master", again, false, default));
        Assert.False(bad.GetProperty("ready").GetBoolean());
        Assert.Equal(2, bad.GetProperty("errors").GetArrayLength());
        Assert.Equal(400, (await Assert.ThrowsAsync<RuleException>(() => service.ImportSessions(campaign.Id, "master", again, true, default))).Status);
        Assert.False(await db.Set<PastSession>().AnyAsync(p => p.Number == 8));
        var invalid = Json(await service.ImportSessions(campaign.Id, "master", Encoding.UTF8.GetBytes("numero;titulo;data;publicado;extra\nx;A;;;\n10;B;31/02/2020;;\n11;C;;talvez;\n"), false, default));
        Assert.Contains("Colunas desconhecidas", invalid.GetProperty("errors")[0].GetProperty("message").GetString());
    }

    [Fact]
    public async Task Known_npcs_expose_only_shared_public_fields()
    {
        var prep = new PreparationService(db, TimeProvider.System);
        db.AddRange(new MasterCharacter { CampaignId = campaign.Id, Name = "Grak", Summary = "Chefe", Notes = "Traidor", SharedWithPlayers = true, ImageUrl = "https://example.test/grak.png" },
            new MasterCharacter { CampaignId = campaign.Id, Name = "Vulto", Notes = "Espião" });
        await db.SaveChangesAsync();
        var known = Json(await prep.KnownNpcsAsync(campaign.Id, "player", 1, default));
        var item = Assert.Single(known.GetProperty("items").EnumerateArray());
        Assert.Equal("Grak", item.GetProperty("name").GetString());
        Assert.False(item.TryGetProperty("notes", out _));
        Assert.Equal("https://example.test/grak.png", item.GetProperty("image").GetString());
        await Assert.ThrowsAsync<RuleException>(() => prep.KnownNpcsAsync(campaign.Id, "outsider", 1, default));
        var hidden = await db.MasterCharacters.SingleAsync(m => m.Name == "Vulto");
        Assert.Equal(404, (await Assert.ThrowsAsync<RuleException>(() => prep.KnownPortraitAsync(campaign.Id, hidden.Id, "player", default))).Status);
    }
}
