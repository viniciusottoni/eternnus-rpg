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
        Assert.Empty(player.GetProperty("chapters").EnumerateArray()); // capítulo oculto (ADR-062)
        await Assert.ThrowsAsync<RuleException>(() => service.Log(campaign.Id, "outsider", null, null, null, 1, default));
        // Filtros por capítulo, avulsas e origem.
        Assert.Equal(2, Json(await service.Log(campaign.Id, "master", null, act.Id.ToString(), null, 1, default)).GetProperty("total").GetInt32());
        Assert.Equal(2, Json(await service.Log(campaign.Id, "master", null, "none", null, 1, default)).GetProperty("total").GetInt32());
        Assert.Equal(2, Json(await service.Log(campaign.Id, "master", null, null, "past", 1, default)).GetProperty("total").GetInt32());
        Assert.Equal(400, (await Assert.ThrowsAsync<RuleException>(() => service.Log(campaign.Id, "master", null, null, "outra", 1, default))).Status);
    }

    [Fact]
    public async Task Players_only_see_chapters_the_master_made_visible()
    {
        var act = await Seed();
        var hidden = await service.SaveChapter(campaign.Id, null, "master", new("Segredo", "arc", "O rei trai."), default);
        await service.SavePast(campaign.Id, null, "master", new(7, "No arco oculto", "Publicada.", Published: true, ChapterId: hidden.Id), default);
        Assert.False(act.Published);
        // Tudo oculto: o jogador não vê capítulos e as sessões vão sem capítulo.
        Assert.Equal(0, Json(await service.ChapterList(campaign.Id, "player", default)).GetProperty("total").GetInt32());
        var log = Json(await service.Log(campaign.Id, "player", null, null, null, 1, default));
        Assert.Empty(log.GetProperty("chapters").EnumerateArray());
        Assert.All(log.GetProperty("items").EnumerateArray(), i => { Assert.Equal(JsonValueKind.Null, i.GetProperty("chapterTitle").ValueKind); Assert.Equal(JsonValueKind.Null, i.GetProperty("chapterId").ValueKind); });
        Assert.Equal(0, Json(await service.Log(campaign.Id, "player", null, act.Id.ToString(), null, 1, default)).GetProperty("total").GetInt32());
        Assert.Equal(3, Json(await service.Log(campaign.Id, "player", null, "none", null, 1, default)).GetProperty("total").GetInt32());
        Assert.DoesNotContain(Json(await service.Search(campaign.Id, "player", "Trevas", null, 1, default)).GetProperty("items").EnumerateArray(), i => i.GetProperty("kind").GetString() == "chapter");

        // Mestre revela o ato; o arco continua oculto. Publicar não muda nada sem o campo (nulo mantém).
        act = await service.SaveChapter(campaign.Id, act.Id, "master", new("Trevas", "act", "Começo sombrio.", act.Revision, Published: true), default);
        act = await service.SaveChapter(campaign.Id, act.Id, "master", new("Trevas", "act", "Começo sombrio.", act.Revision), default);
        Assert.True(act.Published);
        var list = Json(await service.ChapterList(campaign.Id, "player", default));
        var item = Assert.Single(list.GetProperty("items").EnumerateArray());
        Assert.Equal("Trevas", item.GetProperty("title").GetString());
        Assert.Equal("Começo sombrio.", item.GetProperty("summary").GetString());
        Assert.Equal(1, item.GetProperty("sessionCount").GetInt32());
        Assert.Equal(1, item.GetProperty("pastCount").GetInt32());
        Assert.Equal(1, list.GetProperty("looseSessions").GetInt32()); // sessão 7 no arco oculto
        log = Json(await service.Log(campaign.Id, "player", null, null, null, 1, default));
        Assert.Equal(["Trevas"], log.GetProperty("chapters").EnumerateArray().Select(c => c.GetProperty("title").GetString()));
        var rows = log.GetProperty("items").EnumerateArray().ToDictionary(i => i.GetProperty("number").GetInt32());
        Assert.Equal("Trevas", rows[3].GetProperty("chapterTitle").GetString());
        Assert.Equal(JsonValueKind.Null, rows[7].GetProperty("chapterTitle").ValueKind);
        Assert.Equal(0, Json(await service.Log(campaign.Id, "player", null, hidden.Id.ToString(), null, 1, default)).GetProperty("total").GetInt32());
        var entry = Json(await service.LogEntry(campaign.Id, rows[7].GetProperty("key").GetString()!, "player", default));
        Assert.Equal(JsonValueKind.Null, entry.GetProperty("chapterTitle").ValueKind);
        Assert.Equal(JsonValueKind.Null, entry.GetProperty("chapterId").ValueKind);
        Assert.Equal("Segredo", Json(await service.LogEntry(campaign.Id, rows[7].GetProperty("key").GetString()!, "master", default)).GetProperty("chapterTitle").GetString());
        Assert.Contains(Json(await service.Search(campaign.Id, "player", "sombrio", null, 1, default)).GetProperty("items").EnumerateArray(), i => i.GetProperty("kind").GetString() == "chapter");
        Assert.DoesNotContain(Json(await service.Search(campaign.Id, "player", "rei trai", null, 1, default)).GetProperty("items").EnumerateArray(), i => i.GetProperty("kind").GetString() == "chapter");
        Assert.Equal(2, Json(await service.ChapterList(campaign.Id, "master", default)).GetProperty("total").GetInt32());
    }

    [Fact]
    public async Task Only_master_deletes_past_record_with_current_revision_and_number_is_freed()
    {
        await Seed();
        var past = await db.Set<PastSession>().AsNoTracking().SingleAsync(p => p.Number == 1);
        Assert.Equal(403, (await Assert.ThrowsAsync<RuleException>(() => service.DeletePast(campaign.Id, past.Id, "player", past.Revision, default))).Status);
        Assert.Equal(404, (await Assert.ThrowsAsync<RuleException>(() => service.DeletePast(campaign.Id, past.Id, "outsider", past.Revision, default))).Status);
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => service.DeletePast(campaign.Id, past.Id, "master", past.Revision + 1, default))).Status);
        Assert.Equal(404, (await Assert.ThrowsAsync<RuleException>(() => service.DeletePast(campaign.Id, Guid.NewGuid(), "master", 0, default))).Status);
        await service.DeletePast(campaign.Id, past.Id, "master", past.Revision, default);
        db.ChangeTracker.Clear();
        Assert.False(await db.Set<PastSession>().AnyAsync(p => p.Id == past.Id));
        Assert.Equal(3, Json(await service.Log(campaign.Id, "master", null, null, null, 1, default)).GetProperty("total").GetInt32());
        await service.SavePast(campaign.Id, null, "master", new(1, "Blackstones de novo", "Recriada."), default);
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
        var player = Json(await service.Search(campaign.Id, "player", "goblin", null, 1, default)).GetProperty("items").EnumerateArray().Select(i => i.GetProperty("title").GetString()).ToList();
        Assert.Contains("Goblins do norte", player); Assert.Contains("Grak", player); Assert.Contains("Sessão 03 — A cripta", player);
        Assert.DoesNotContain("Plano secreto", player); Assert.DoesNotContain("Vulto", player); Assert.DoesNotContain("Sessão 04 — Rascunho", player);
        var master = Json(await service.Search(campaign.Id, "master", "goblin", null, 1, default)).GetProperty("items").EnumerateArray().Select(i => i.GetProperty("route").GetString()).ToList();
        Assert.Contains($"campaign/{campaign.Id:D}/prep", master);
        var premise = Json(await service.Search(campaign.Id, "player", "entidades", null, 1, default)).GetProperty("items")[0];
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
        var known = Json(await prep.KnownNpcsAsync(campaign.Id, "player", null, null, 1, default));
        var item = Assert.Single(known.GetProperty("items").EnumerateArray());
        Assert.Equal("Grak", item.GetProperty("name").GetString());
        Assert.False(item.TryGetProperty("notes", out _));
        Assert.Equal("https://example.test/grak.png", item.GetProperty("image").GetString());
        await Assert.ThrowsAsync<RuleException>(() => prep.KnownNpcsAsync(campaign.Id, "outsider", null, null, 1, default));
        var hidden = await db.MasterCharacters.SingleAsync(m => m.Name == "Vulto");
        Assert.Equal(404, (await Assert.ThrowsAsync<RuleException>(() => prep.KnownPortraitAsync(campaign.Id, hidden.Id, "player", default))).Status);
    }

    [Fact]
    public async Task Known_npcs_link_the_lore_page_only_for_readers_and_deleting_the_npc_unlinks_pages()
    {
        var prep = new PreparationService(db, TimeProvider.System);
        var grak = new MasterCharacter { CampaignId = campaign.Id, Name = "Grak", SharedWithPlayers = true };
        var vulto = new MasterCharacter { CampaignId = campaign.Id, Name = "Vulto" };
        db.AddRange(grak, vulto); await db.SaveChangesAsync();
        async Task<JsonElement> Page(string user) => Json(await prep.KnownNpcsAsync(campaign.Id, user, null, null, 1, default)).GetProperty("items")[0].GetProperty("page");

        // Página privada: só o mestre vê o vínculo; o jogador não sabe que ela existe.
        var lore = await service.Save(campaign.Id, null, "master", new("Grak, o chefe", "Nasceu nas montanhas.", "text", "self", Secrets: "Trai o rei", NpcId: grak.Id), default);
        Assert.Equal(JsonValueKind.Null, (await Page("player")).ValueKind);
        Assert.Equal(lore.Id, (await Page("master")).GetProperty("id").GetGuid());
        Assert.Equal("self", (await Page("master")).GetProperty("visibility").GetString());

        // Compartilhada com a mesa: o jogador recebe só id, título e visibilidade, nunca os segredos.
        lore = await service.Save(campaign.Id, lore.Id, "master", new("Grak, o chefe", "Nasceu nas montanhas.", "text", "table", Secrets: "Trai o rei", NpcId: grak.Id, Revision: lore.Revision), default);
        var shared = await Page("player");
        Assert.Equal("Grak, o chefe", shared.GetProperty("title").GetString());
        Assert.DoesNotContain("Trai", shared.GetRawText());

        // NPC oculto não aparece, mesmo com página legível ligada a ele.
        await service.Save(campaign.Id, null, "master", new("Vulto", "Espião.", "text", "table", NpcId: vulto.Id), default);
        Assert.Single(Json(await prep.KnownNpcsAsync(campaign.Id, "player", null, null, 1, default)).GetProperty("items").EnumerateArray());

        // Lixeira esconde o vínculo; a Preparação do mestre mostra a página ligada.
        await service.Delete(campaign.Id, lore.Id, "master", lore.Revision, false, default);
        Assert.Equal(JsonValueKind.Null, (await Page("master")).ValueKind);
        await service.Delete(campaign.Id, lore.Id, "master", lore.Revision, true, default); // mesma instância rastreada: revisão já atualizada
        var npcs = Json(await prep.NpcsAsync(campaign.Id, "master", default)).GetProperty("items").EnumerateArray().ToList();
        Assert.Equal(lore.Id, npcs.Single(n => n.GetProperty("name").GetString() == "Grak").GetProperty("page").GetProperty("id").GetGuid());
        Assert.Equal("Grak", Json(await service.List(campaign.Id, "master", "Grak", null, 1, false, default)).GetProperty("items")[0].GetProperty("npc").GetString());
        Assert.Equal(JsonValueKind.Null, Json(await service.List(campaign.Id, "player", "Grak", null, 1, false, default)).GetProperty("items")[0].GetProperty("npc").ValueKind);

        // Excluir o NPC mantém a página e remove o vínculo, que antes impedia salvá-la.
        await prep.DeleteNpcAsync(campaign.Id, grak.Id, "master", default);
        db.ChangeTracker.Clear();
        var kept = await db.Set<WorkspacePage>().SingleAsync(p => p.Id == lore.Id);
        Assert.Null(kept.NpcId);
        await service.Save(campaign.Id, kept.Id, "master", new("Grak, o chefe", "Ainda lembrado.", "text", "table", Revision: kept.Revision), default);
    }

    [Fact]
    public async Task New_pages_cannot_use_the_npc_kind_but_legacy_npc_pages_stay_editable()
    {
        Assert.Equal(400, (await Assert.ThrowsAsync<RuleException>(() => service.Save(campaign.Id, null, "master", new("Grak", "x", "npc"), default))).Status);
        var text = await service.Save(campaign.Id, null, "master", new("Grak", "x", "text"), default);
        Assert.Equal(400, (await Assert.ThrowsAsync<RuleException>(() => service.Save(campaign.Id, text.Id, "master", new("Grak", "x", "npc", Revision: text.Revision), default))).Status);
        var legacy = new WorkspacePage { CampaignId = campaign.Id, OwnerId = "master", Kind = "npc", Title = "Antigo" };
        db.Add(legacy); await db.SaveChangesAsync();
        var saved = await service.Save(campaign.Id, legacy.Id, "master", new("Antigo", "novo texto", "npc", Revision: legacy.Revision), default);
        Assert.Equal("npc", saved.Kind);
    }

    [Fact]
    public async Task Chapters_and_session_log_filter_by_their_columns()
    {
        await Seed();
        await service.SaveChapter(campaign.Id, null, "master", new("Arco do Norte", "arc", "Gelo e lobos"), default);
        static string[] Titles(JsonElement e) => e.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("title").GetString()!).ToArray();
        Assert.Equal(["Arco do Norte"], Titles(Json(await service.ChapterList(campaign.Id, "master", default, 1, kind: "arc"))));
        Assert.Equal(["Arco do Norte"], Titles(Json(await service.ChapterList(campaign.Id, "master", default, 1, q: "lobos"))));
        Assert.Equal(["Trevas"], Titles(Json(await service.ChapterList(campaign.Id, "master", default, 1, q: "trevas"))));
        Assert.Empty(Titles(Json(await service.ChapterList(campaign.Id, "master", default, 1, published: true))));
        Assert.Equal(2, Json(await service.ChapterList(campaign.Id, "master", default, 1, published: false)).GetProperty("total").GetInt32());
        // Jogador não filtra por visibilidade: só vê os visíveis de qualquer jeito.
        Assert.Equal(0, Json(await service.ChapterList(campaign.Id, "player", default, 1, published: false)).GetProperty("total").GetInt32());
        Assert.Equal(400, (await Assert.ThrowsAsync<RuleException>(() => service.ChapterList(campaign.Id, "master", default, 1, kind: "saga"))).Status);

        static int[] Numbers(JsonElement e) => e.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("number").GetInt32()).ToArray();
        Assert.Equal(new[] { 3, 1 }, Numbers(Json(await service.Log(campaign.Id, "master", null, null, null, 1, default, "published"))));
        Assert.Equal(new[] { 4, 2 }, Numbers(Json(await service.Log(campaign.Id, "master", null, null, null, 1, default, "draft"))));
        Assert.Equal(new[] { 3, 1 }, Numbers(Json(await service.Log(campaign.Id, "player", null, null, null, 1, default, "draft"))));
        Assert.Equal(400, (await Assert.ThrowsAsync<RuleException>(() => service.Log(campaign.Id, "master", null, null, null, 1, default, "secreta"))).Status);
    }

    [Fact]
    public async Task Search_returns_every_hit_paginated_by_fifteen_with_kind_filter()
    {
        // 20 NPCs e 1 capítulo com "goblin": antes a busca parava em 8 por tipo.
        for (var i = 1; i <= 20; i++) db.Add(new MasterCharacter { CampaignId = campaign.Id, Name = $"Goblin {i:00}", SharedWithPlayers = i % 2 == 0 });
        await db.SaveChangesAsync();
        await service.SaveChapter(campaign.Id, null, "master", new("Covil goblin", "act"), default);
        var page1 = Json(await service.Search(campaign.Id, "master", "goblin", null, 1, default));
        Assert.Equal(21, page1.GetProperty("total").GetInt32());
        Assert.Equal(15, page1.GetProperty("items").GetArrayLength());
        Assert.Equal(15, page1.GetProperty("pageSize").GetInt32());
        Assert.False(page1.GetProperty("truncated").GetBoolean());
        var page2 = Json(await service.Search(campaign.Id, "master", "goblin", null, 2, default));
        Assert.Equal(6, page2.GetProperty("items").GetArrayLength());
        // Página além da última volta para a última.
        Assert.Equal(2, Json(await service.Search(campaign.Id, "master", "goblin", null, 99, default)).GetProperty("page").GetInt32());
        // Filtro de tipo antes da paginação; jogador só vê os compartilhados.
        var npcs = Json(await service.Search(campaign.Id, "master", "goblin", "npc", 1, default));
        Assert.Equal(20, npcs.GetProperty("total").GetInt32());
        Assert.All(npcs.GetProperty("items").EnumerateArray(), i => Assert.Equal("npc", i.GetProperty("kind").GetString()));
        Assert.Equal(10, Json(await service.Search(campaign.Id, "player", "goblin", "npc", 1, default)).GetProperty("total").GetInt32());
        Assert.Equal(400, (await Assert.ThrowsAsync<RuleException>(() => service.Search(campaign.Id, "master", "goblin", "segredo", 1, default))).Status);
    }

    [Fact]
    public async Task Known_npcs_filter_by_name_and_kind_and_open_on_the_focused_page()
    {
        var prep = new PreparationService(db, TimeProvider.System);
        for (var i = 1; i <= 18; i++) db.Add(new MasterCharacter { CampaignId = campaign.Id, Name = $"Aliado {i:00}", Summary = i == 3 ? "Ferreiro da vila" : "", Kind = i <= 2 ? NpcKinds.Creature : NpcKinds.Npc, SharedWithPlayers = true });
        await db.SaveChangesAsync();
        var all = Json(await prep.KnownNpcsAsync(campaign.Id, "player", null, null, 1, default));
        Assert.Equal(18, all.GetProperty("total").GetInt32());
        Assert.Equal(15, all.GetProperty("items").GetArrayLength());
        Assert.Equal("Aliado 03", Assert.Single(Json(await prep.KnownNpcsAsync(campaign.Id, "player", "ferreiro", null, 1, default)).GetProperty("items").EnumerateArray()).GetProperty("name").GetString());
        Assert.Equal(2, Json(await prep.KnownNpcsAsync(campaign.Id, "player", null, NpcKinds.Creature, 1, default)).GetProperty("total").GetInt32());
        // Link da busca: o NPC 17 está na página 2.
        var focus = await db.MasterCharacters.Where(m => m.Name == "Aliado 17").Select(m => m.Id).SingleAsync();
        var focused = Json(await prep.KnownNpcsAsync(campaign.Id, "player", null, null, 1, default, focus));
        Assert.Equal(2, focused.GetProperty("page").GetInt32());
        Assert.Contains(focused.GetProperty("items").EnumerateArray(), i => i.GetProperty("id").GetGuid() == focus);
        Assert.Equal(400, (await Assert.ThrowsAsync<RuleException>(() => prep.KnownNpcsAsync(campaign.Id, "player", "a", null, 1, default))).Status);
    }
}
