using System.Text.Json;
using Eternnus.Web;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Eternnus.Tests;

/// <summary>Regras da Guilda em SQLite. Bloqueios reais e corridas em PostgreSQL ficam em tests/guild.mjs.</summary>
public sealed class GuildTests : IAsyncLifetime
{
    sealed class FakeProgression(GameDb db, AuditService audit) : ProgressionService(db, audit)
    {
        public readonly List<(string User, string Reason, string Key)> Awards = [];
        public string? BlockMessage;
        public override Task AwardAsync(string userId, string reason, string sourceKey, CancellationToken ct = default)
        {
            Awards.Add((userId, reason, sourceKey));
            return Task.CompletedTask;
        }
        public override Task RequireLevelAsync(string userId, string feature, CancellationToken ct = default) =>
            BlockMessage is null ? Task.CompletedTask : throw new RuleException(403, BlockMessage);
    }

    static readonly Guid Avisos = Guid.Parse("00000000-0000-4000-8000-000000000201");
    static readonly Guid Taverna = Guid.Parse("00000000-0000-4000-8000-000000000202");
    static readonly Guid Regras = Guid.Parse("00000000-0000-4000-8000-000000000204");
    const string Common = "common", Other = "other", Veteran = "veteran", Ambassador = "ambassador", Admin = "admin";

    readonly SqliteConnection connection = new("Data Source=:memory:");
    GameDb db = null!;
    FakeProgression progression = null!;
    GuildService guild = null!;

    public async Task InitializeAsync()
    {
        await connection.OpenAsync();
        db = new GameDb(new DbContextOptionsBuilder<GameDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        db.Users.AddRange(
            User(Common, "Ana", PlatformRoles.Common, 1),
            User(Other, "Bruno", PlatformRoles.Common, 1),
            User(Veteran, "Clara", PlatformRoles.Common, 3),
            User(Ambassador, "Duda", PlatformRoles.Ambassador, 1),
            User(Admin, "Eva", PlatformRoles.Admin, 1));
        await db.SaveChangesAsync();
        var audit = new AuditService(db);
        progression = new FakeProgression(db, audit);
        guild = new GuildService(db, audit, progression);
    }
    static AppUser User(string id, string name, string role, int level) =>
        new() { Id = id, UserName = id, Email = id + "@example.test", EmailConfirmed = true, DisplayName = name, Role = role, Level = level };
    public async Task DisposeAsync() { await db.DisposeAsync(); await connection.DisposeAsync(); }

    static T Prop<T>(object o, string name) => (T)o.GetType().GetProperty(name)!.GetValue(o)!;
    static JsonElement Json(object o) => JsonSerializer.SerializeToElement(o, new JsonSerializerOptions(JsonSerializerDefaults.Web));
    async Task<Guid> TopicAsync(string user = Common, Guid? category = null, string body = "Olá, aventureiros!") =>
        Prop<Guid>(await guild.CreateTopicAsync(new(category ?? Taverna, "Apresentação na Taverna", body), user, default), "id");
    async Task<long> ReplyAsync(Guid topic, string user, string body = "Bem-vindo!") => Prop<long>(await guild.ReplyAsync(topic, new(body), user, default), "id");
    async Task<long> FirstPostAsync(Guid topic) => await db.GuildPosts.Where(p => p.TopicId == topic).OrderBy(p => p.Id).Select(p => p.Id).FirstAsync();
    async Task<int> StatusAsync(Func<Task> action) => (await Assert.ThrowsAsync<RuleException>(action)).Status;

    [Fact]
    public async Task Staff_only_categories_reject_common_users_and_accept_staff()
    {
        Assert.Equal(403, await StatusAsync(() => TopicAsync(Common, Avisos)));
        var id = await TopicAsync(Ambassador, Avisos);
        Assert.True(await db.GuildTopics.AnyAsync(t => t.Id == id && t.CategoryId == Avisos));
        // Responder a um aviso não exige papel.
        await ReplyAsync(id, Common);
    }

    [Fact]
    public async Task Category_minimum_level_blocks_with_required_level_and_progression_gate_applies()
    {
        var error = await Assert.ThrowsAsync<RuleException>(() => TopicAsync(Common, Regras));
        Assert.Equal(403, error.Status);
        Assert.Contains("nível 2", error.Message);
        await TopicAsync(Veteran, Regras);
        await TopicAsync(Admin, Regras); // equipe ignora o nível mínimo

        var listed = Json(await guild.TopicsAsync(Common, "regras-e-sistemas", null, null, 1, false, default));
        Assert.False(listed.GetProperty("category").GetProperty("canCreateTopic").GetBoolean());
        Assert.Equal(2, listed.GetProperty("category").GetProperty("requiredLevel").GetInt32());

        progression.BlockMessage = "Abrir tópicos na Guilda exige nível 2.";
        Assert.Equal(403, await StatusAsync(() => TopicAsync(Common, Taverna)));
        var categories = Json(await guild.CategoriesAsync(Common, default));
        Assert.Equal("Abrir tópicos na Guilda exige nível 2.", categories.GetProperty("viewer").GetProperty("topicBlockedReason").GetString());
        await TopicAsync(Ambassador, Taverna);
    }

    [Fact]
    public async Task Topic_creation_validates_text_and_creates_first_post_with_counters_and_xp()
    {
        Assert.Equal(400, await StatusAsync(() => guild.CreateTopicAsync(new(Taverna, "Oi", "Corpo válido"), Common, default)));
        Assert.Equal(400, await StatusAsync(() => guild.CreateTopicAsync(new(Taverna, "Título válido", " x "), Common, default)));
        Assert.Equal(400, await StatusAsync(() => guild.CreateTopicAsync(new(Taverna, "Título válido", new string('a', 10001)), Common, default)));
        Assert.Equal(404, await StatusAsync(() => guild.CreateTopicAsync(new(Guid.NewGuid(), "Título válido", "Corpo"), Common, default)));

        var id = await TopicAsync(Common, body: "<img src=x onerror=alert(1)>");
        var topic = await db.GuildTopics.SingleAsync(t => t.Id == id);
        Assert.Equal(1, topic.PostCount);
        Assert.Equal("<img src=x onerror=alert(1)>", (await db.GuildPosts.SingleAsync(p => p.TopicId == id)).Body);
        Assert.Contains((Common, XpReasons.GuildTopic, $"guild_topic:{id}"), progression.Awards);

        var r1 = await ReplyAsync(id, Other);
        var r2 = await ReplyAsync(id, Veteran);
        topic = await db.GuildTopics.AsNoTracking().SingleAsync(t => t.Id == id);
        Assert.Equal(3, topic.PostCount);
        Assert.Contains((Other, XpReasons.GuildPost, $"guild_post:{r1}"), progression.Awards);
        Assert.Contains((Veteran, XpReasons.GuildPost, $"guild_post:{r2}"), progression.Awards);

        var categories = Json(await guild.CategoriesAsync(Common, default)).GetProperty("items").EnumerateArray().ToList();
        Assert.Equal(9, categories.Count);
        Assert.Equal("avisos", categories[0].GetProperty("slug").GetString());
        var taverna = categories.Single(c => c.GetProperty("slug").GetString() == "taverna");
        Assert.Equal(1, taverna.GetProperty("topicCount").GetInt32());
        Assert.Equal(3, taverna.GetProperty("postCount").GetInt32());
        Assert.Equal(id, taverna.GetProperty("lastTopic").GetProperty("id").GetGuid());
        Assert.Equal("Ana", taverna.GetProperty("lastTopic").GetProperty("author").GetString());
    }

    [Fact]
    public async Task Locked_topics_reject_replies_and_edits_except_from_staff_and_stale_revision_conflicts()
    {
        var id = await TopicAsync();
        var first = await FirstPostAsync(id);
        Assert.Equal(403, await StatusAsync(() => guild.ModerateTopicAsync(id, new(true, null, null, null, "Discussão encerrada", 1), Common, default)));
        Assert.Equal(400, await StatusAsync(() => guild.ModerateTopicAsync(id, new(true, null, null, null, "", 1), Ambassador, default)));
        var result = await guild.ModerateTopicAsync(id, new(true, true, null, null, "Discussão encerrada", 1), Ambassador, default);
        Assert.Equal(2, Prop<int>(result, "Revision"));
        Assert.Equal(409, await StatusAsync(() => guild.ModerateTopicAsync(id, new(false, null, null, null, "Reabrir", 1), Admin, default)));

        Assert.Equal(409, await StatusAsync(() => ReplyAsync(id, Other)));
        Assert.Equal(409, await StatusAsync(() => guild.EditAsync(first, new("Editado depois"), Common, default)));
        await ReplyAsync(id, Admin);
        var view = Json(await guild.TopicAsync(id, Other, 1, default));
        Assert.False(view.GetProperty("canReply").GetBoolean());
        Assert.True(view.GetProperty("topic").GetProperty("locked").GetBoolean());
        Assert.True(Json(await guild.TopicAsync(id, Admin, 1, default)).GetProperty("canReply").GetBoolean());

        var entry = await db.Audit.SingleAsync(a => a.TargetId == id.ToString());
        Assert.Equal(Ambassador, entry.ActorId);
        Assert.Equal("guild.topic.update", entry.Action);
        Assert.Contains("Discussão encerrada", entry.Summary);

        // Mover para outra categoria e remover/restaurar também são auditados.
        await guild.ModerateTopicAsync(id, new(null, null, Regras, true, "Lugar certo", 2), Admin, default);
        Assert.Equal(404, await StatusAsync(() => guild.TopicAsync(id, Other, 1, default)));
        Assert.True(Json(await guild.TopicAsync(id, Admin, 1, default)).GetProperty("topic").GetProperty("deleted").GetBoolean());
        await guild.ModerateTopicAsync(id, new(null, null, null, false, "Engano", 3), Admin, default);
        Assert.Equal(Regras, (await db.GuildTopics.AsNoTracking().SingleAsync(t => t.Id == id)).CategoryId);
        Assert.Equal(["guild.topic.update", "guild.topic.delete", "guild.topic.restore"], await db.Audit.Where(a => a.TargetId == id.ToString()).OrderBy(a => a.Id).Select(a => a.Action).ToListAsync());
    }

    [Fact]
    public async Task Useful_is_unique_per_user_never_on_own_post_and_awards_the_author()
    {
        var id = await TopicAsync();
        var post = await FirstPostAsync(id);
        Assert.Equal(403, await StatusAsync(() => guild.MarkUsefulAsync(post, Common, default)));
        var first = Json(await guild.MarkUsefulAsync(post, Other, default));
        Assert.Equal(1, first.GetProperty("usefulCount").GetInt32());
        Assert.True(first.GetProperty("markedUseful").GetBoolean());
        Assert.Equal(1, Json(await guild.MarkUsefulAsync(post, Other, default)).GetProperty("usefulCount").GetInt32());
        Assert.Equal(1, await db.GuildReactions.CountAsync(r => r.PostId == post));
        Assert.Single(progression.Awards, a => a == (Common, XpReasons.GuildUsefulReceived, $"guild_useful:{post}:{Other}"));
        // A chave composta do banco também impede duplicata.
        db.ChangeTracker.Clear();
        db.GuildReactions.Add(new GuildReaction { PostId = post, UserId = Other });
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        db.ChangeTracker.Clear();

        await guild.MarkUsefulAsync(post, Veteran, default);
        Assert.Equal(2, (await db.GuildPosts.AsNoTracking().SingleAsync(p => p.Id == post)).UsefulCount);
        var unmarked = Json(await guild.UnmarkUsefulAsync(post, Other, default));
        Assert.Equal(1, unmarked.GetProperty("usefulCount").GetInt32());
        Assert.False(unmarked.GetProperty("markedUseful").GetBoolean());
        Assert.Equal(1, Json(await guild.UnmarkUsefulAsync(post, Other, default)).GetProperty("usefulCount").GetInt32());
        var view = Json(await guild.TopicAsync(id, Veteran, 1, default)).GetProperty("posts")[0];
        Assert.True(view.GetProperty("markedUseful").GetBoolean());
        Assert.True(view.GetProperty("canMarkUseful").GetBoolean());
        Assert.False(Json(await guild.TopicAsync(id, Common, 1, default)).GetProperty("posts")[0].GetProperty("canMarkUseful").GetBoolean());
    }

    [Fact]
    public async Task Reports_are_unique_per_user_and_never_on_own_post()
    {
        var id = await TopicAsync();
        var post = await FirstPostAsync(id);
        Assert.Equal(403, await StatusAsync(() => guild.ReportAsync(post, new("Conteúdo ofensivo"), Common, default)));
        Assert.Equal(400, await StatusAsync(() => guild.ReportAsync(post, new("ruim"), Other, default)));
        await guild.ReportAsync(post, new("Conteúdo ofensivo"), Other, default);
        Assert.Equal(409, await StatusAsync(() => guild.ReportAsync(post, new("De novo, ofensivo"), Other, default)));
        // Denúncia na resposta (o tópico segue aberto): quem denunciou vê o próprio registro, nunca a contagem.
        var reply = await ReplyAsync(await TopicAsync(Veteran), Common, "Resposta qualquer");
        await guild.ReportAsync(reply, new("Conteúdo ofensivo"), Other, default);
        var view = Json(await guild.TopicAsync(await db.GuildPosts.Where(p => p.Id == reply).Select(p => p.TopicId).SingleAsync(), Other, 1, default)).GetProperty("posts")[1];
        Assert.False(view.GetProperty("canReport").GetBoolean());
        Assert.True(view.GetProperty("reported").GetBoolean());
        Assert.Equal(JsonValueKind.Null, view.GetProperty("openReports").ValueKind);
        Assert.Equal(1, Json(await guild.TopicAsync(id, Admin, 1, default)).GetProperty("posts")[0].GetProperty("openReports").GetInt32());
    }

    [Fact]
    public async Task First_report_on_the_opening_hides_the_whole_topic_until_moderation_decides()
    {
        var id = await TopicAsync(Common, body: "Abertura ofensiva");
        var opening = await FirstPostAsync(id);
        await ReplyAsync(id, Veteran, "Resposta");
        var result = Json(await guild.ReportAsync(opening, new("Conteúdo ofensivo"), Other, default));
        Assert.True(result.GetProperty("hidden").GetBoolean());
        Assert.True(result.GetProperty("topicHidden").GetBoolean());

        // Membros: fora das listas, contagens, recentes e leitura; resposta bloqueada.
        Assert.Equal(404, await StatusAsync(() => guild.TopicAsync(id, Other, 1, default)));
        Assert.Equal(404, await StatusAsync(() => guild.ReplyAsync(id, new("Oi?"), Veteran, default)));
        Assert.Equal(0, Json(await guild.TopicsAsync(Other, "taverna", null, null, 1, false, default)).GetProperty("total").GetInt32());
        Assert.Empty(Json(await guild.RecentAsync(Other, 5, default)).EnumerateArray());
        var taverna = Json(await guild.CategoriesAsync(Other, default)).GetProperty("items").EnumerateArray().Single(c => c.GetProperty("slug").GetString() == "taverna");
        Assert.Equal(0, taverna.GetProperty("topicCount").GetInt32());
        // Autor: lê com aviso e o próprio texto, mas não edita nem responde até a decisão.
        var mine = Json(await guild.TopicAsync(id, Common, 1, default));
        Assert.True(mine.GetProperty("topic").GetProperty("held").GetBoolean());
        Assert.False(mine.GetProperty("canReply").GetBoolean());
        Assert.Equal("Abertura ofensiva", mine.GetProperty("posts")[0].GetProperty("body").GetString());
        Assert.False(mine.GetProperty("posts")[0].GetProperty("canEdit").GetBoolean());
        Assert.Equal(409, await StatusAsync(() => guild.EditAsync(opening, new("Corrigido"), Common, default)));
        Assert.Equal(409, await StatusAsync(() => guild.ReplyAsync(id, new("Posso explicar"), Common, default)));
        // Equipe: lista com o selo e ainda pode responder.
        var staffList = Json(await guild.TopicsAsync(Ambassador, "taverna", null, null, 1, false, default)).GetProperty("items")[0];
        Assert.True(staffList.GetProperty("held").GetBoolean());
        var queue = Json(await guild.ReportsAsync(Ambassador, "open", 1, default)).GetProperty("items")[0].GetProperty("post");
        Assert.True(queue.GetProperty("held").GetBoolean());
        Assert.True(queue.GetProperty("topic").GetProperty("held").GetBoolean());
        // Segunda denúncia na mensagem já oculta só entra na fila.
        await guild.ReportAsync(opening, new("Também achei ofensivo"), Veteran, default);

        // Arquivar uma das duas mantém oculto; arquivar a última libera.
        var reports = await db.GuildReports.Where(r => r.PostId == opening).OrderBy(r => r.Id).Select(r => r.Id).ToListAsync();
        await guild.ResolveAsync(reports[0], new("dismissed", "Sem violação"), Admin, default);
        Assert.Equal(404, await StatusAsync(() => guild.TopicAsync(id, Other, 1, default)));
        await guild.ResolveAsync(reports[1], new("dismissed", "Sem violação"), Admin, default);
        var back = Json(await guild.TopicAsync(id, Other, 1, default));
        Assert.False(back.GetProperty("topic").GetProperty("held").GetBoolean());
        Assert.Equal("Abertura ofensiva", back.GetProperty("posts")[0].GetProperty("body").GetString());
        Assert.True(back.GetProperty("canReply").GetBoolean());
        Assert.False(await db.Audit.AnyAsync(a => a.ActorId == Other || a.ActorId == Veteran)); // denunciar não gera auditoria

        // Mantida pela moderação: nova denúncia vai à fila sem ocultar, até o autor editar o texto.
        var again = Json(await guild.ReportAsync(opening, new("Insisto que é ofensivo"), Ambassador, default));
        Assert.False(again.GetProperty("hidden").GetBoolean());
        Assert.False(again.GetProperty("topicHidden").GetBoolean());
        await guild.EditAsync(opening, new("Texto novo, de novo ofensivo"), Common, default);
        Assert.True(Json(await guild.ReportAsync(opening, new("Editou e piorou"), Admin, default)).GetProperty("topicHidden").GetBoolean());
    }

    [Fact]
    public async Task Report_on_a_reply_hides_only_that_reply_and_removal_releases_it_as_removed()
    {
        var id = await TopicAsync(Veteran);
        var reply = await ReplyAsync(id, Common, "Spam aqui");
        var result = Json(await guild.ReportAsync(reply, new("Propaganda"), Other, default));
        Assert.True(result.GetProperty("hidden").GetBoolean());
        Assert.False(result.GetProperty("topicHidden").GetBoolean());

        var member = Json(await guild.TopicAsync(id, Other, 1, default));
        Assert.True(member.GetProperty("canReply").GetBoolean());
        var hidden = member.GetProperty("posts")[1];
        Assert.True(hidden.GetProperty("held").GetBoolean());
        Assert.Equal(JsonValueKind.Null, hidden.GetProperty("body").ValueKind);
        Assert.False(hidden.GetProperty("canMarkUseful").GetBoolean());
        Assert.Equal(404, await StatusAsync(() => guild.MarkUsefulAsync(reply, Veteran, default)));
        Assert.Equal("Spam aqui", Json(await guild.TopicAsync(id, Common, 1, default)).GetProperty("posts")[1].GetProperty("body").GetString());
        Assert.Equal("Spam aqui", Json(await guild.TopicAsync(id, Admin, 1, default)).GetProperty("posts")[1].GetProperty("body").GetString());

        // Remoção direta pela moderação resolve a denúncia e encerra a ocultação: fica "removida pela moderação".
        await guild.ModerateDeletePostAsync(reply, new("Propaganda"), Ambassador, default);
        var after = Json(await guild.TopicAsync(id, Other, 1, default)).GetProperty("posts")[1];
        Assert.False(after.GetProperty("held").GetBoolean());
        Assert.Equal("moderation", after.GetProperty("removed").GetString());
        Assert.Null((await db.GuildPosts.AsNoTracking().SingleAsync(p => p.Id == reply)).HeldAt);
    }

    [Fact]
    public async Task Staff_messages_are_reported_without_being_hidden()
    {
        var id = await TopicAsync(Ambassador, Avisos);
        var result = Json(await guild.ReportAsync(await FirstPostAsync(id), new("Não concordo com o aviso"), Common, default));
        Assert.False(result.GetProperty("hidden").GetBoolean());
        Assert.False(result.GetProperty("topicHidden").GetBoolean());
        Assert.Equal(1, Json(await guild.TopicsAsync(Other, "avisos", null, null, 1, false, default)).GetProperty("total").GetInt32());
        Assert.Equal(1, Json(await guild.ReportsAsync(Admin, "open", 1, default)).GetProperty("total").GetInt32());
    }

    [Fact]
    public async Task New_halls_are_seeded_open_to_every_level()
    {
        var items = Json(await guild.CategoriesAsync(Common, default)).GetProperty("items").EnumerateArray()
            .Select(c => (c.GetProperty("slug").GetString(), c.GetProperty("minLevelToPost").GetInt32(), c.GetProperty("staffOnly").GetBoolean())).ToList();
        Assert.Equal(9, items.Count);
        // Ordem da jornada (ADR-071): avisos, iniciantes, sugestões, conversa, grupo, mestres, artes, regras, fichas.
        Assert.Equal(new[] { "avisos", "portal-do-aprendiz", "forja-de-ideias", "taverna", "procura-se-grupo", "mestres-e-campanhas", "galeria-do-artifice", "regras-e-sistemas", "fichas-e-biblioteca" }, items.Select(i => i.Item1).ToArray());
        Assert.All(items.Where(i => i.Item1 is "forja-de-ideias" or "galeria-do-artifice" or "portal-do-aprendiz"), i => Assert.Equal((1, false), (i.Item2, i.Item3)));
        await TopicAsync(Common, Guid.Parse("00000000-0000-4000-8000-000000000207"));
    }

    [Fact]
    public async Task Resolving_as_removed_deletes_the_post_and_closes_every_open_report_with_audit()
    {
        var id = await TopicAsync(Common, body: "Mensagem ofensiva");
        var post = await FirstPostAsync(id);
        await ReplyAsync(id, Admin, "Resposta da equipe");
        var report = Prop<long>(await guild.ReportAsync(post, new("Conteúdo ofensivo"), Other, default), "id");
        await guild.ReportAsync(post, new("Desrespeito na Taverna"), Veteran, default);

        Assert.Equal(403, await StatusAsync(() => guild.ReportsAsync(Common, "open", 1, default)));
        var queue = Json(await guild.ReportsAsync(Ambassador, "open", 1, default));
        Assert.Equal(2, queue.GetProperty("total").GetInt32());
        var item = queue.GetProperty("items")[0];
        Assert.Equal("Bruno", item.GetProperty("reporter").GetProperty("name").GetString());
        Assert.Equal(2, item.GetProperty("postReports").GetInt32());
        Assert.Equal("Mensagem ofensiva", item.GetProperty("post").GetProperty("excerpt").GetString());
        Assert.Equal(20, queue.GetProperty("pageSize").GetInt32());
        Assert.Equal(1, Json(await guild.ReportsAsync(Ambassador, "open", 1, default, "desrespeito")).GetProperty("total").GetInt32());
        Assert.Equal(2, Json(await guild.ReportsAsync(Ambassador, "open", 1, default, "ofensiva")).GetProperty("total").GetInt32());
        Assert.Equal(0, Json(await guild.ReportsAsync(Ambassador, "open", 1, default, "inexistente")).GetProperty("total").GetInt32());
        Assert.Equal(400, await StatusAsync(() => guild.ReportsAsync(Ambassador, "open", 1, default, null, "removed")));

        Assert.Equal(400, await StatusAsync(() => guild.ResolveAsync(report, new("banned", "Motivo"), Ambassador, default)));
        Assert.Equal(400, await StatusAsync(() => guild.ResolveAsync(report, new("removed", ""), Ambassador, default)));
        var result = await guild.ResolveAsync(report, new("removed", "Ofensa a outro jogador"), Ambassador, default);
        Assert.Equal(1, Prop<int>(result, "alsoResolved"));
        Assert.Equal(409, await StatusAsync(() => guild.ResolveAsync(report, new("dismissed", "Repetido"), Admin, default)));

        var stored = await db.GuildPosts.AsNoTracking().SingleAsync(p => p.Id == post);
        Assert.NotNull(stored.DeletedAt);
        Assert.Equal(Ambassador, stored.DeletedById);
        Assert.False(await db.GuildReports.AnyAsync(r => r.PostId == post && r.ResolvedAt == null));
        Assert.All(await db.GuildReports.AsNoTracking().Where(r => r.PostId == post).ToListAsync(), r => Assert.Equal("removed", r.Resolution));
        var entry = await db.Audit.SingleAsync(a => a.Action == "guild.report.remove");
        Assert.Equal(Ambassador, entry.ActorId);
        Assert.Contains("Ofensa a outro jogador", entry.Summary);

        var common = Json(await guild.TopicAsync(id, Other, 1, default)).GetProperty("posts")[0];
        Assert.Equal("moderation", common.GetProperty("removed").GetString());
        Assert.Equal(JsonValueKind.Null, common.GetProperty("body").ValueKind);
        Assert.False(common.GetProperty("canReport").GetBoolean());
        var staff = Json(await guild.TopicAsync(id, Admin, 1, default)).GetProperty("posts")[0];
        Assert.Equal("Mensagem ofensiva", staff.GetProperty("body").GetString());
        Assert.Equal(0, Json(await guild.ReportsAsync(Admin, "open", 1, default)).GetProperty("total").GetInt32());
        Assert.Equal(2, Json(await guild.ReportsAsync(Admin, "resolved", 1, default)).GetProperty("total").GetInt32());
        Assert.Equal(2, Json(await guild.ReportsAsync(Admin, "resolved", 1, default, null, "removed")).GetProperty("total").GetInt32());
        Assert.Equal(0, Json(await guild.ReportsAsync(Admin, "resolved", 1, default, null, "dismissed")).GetProperty("total").GetInt32());

        // Restaurar volta o texto; mensagens removidas pelo autor não podem ser restauradas.
        await guild.ModerateRestorePostAsync(post, new("Contexto esclarecido"), Admin, default);
        Assert.Null((await db.GuildPosts.AsNoTracking().SingleAsync(p => p.Id == post)).DeletedAt);
        Assert.Equal(409, await StatusAsync(() => guild.ModerateRestorePostAsync(post, new("De novo"), Admin, default)));
        await guild.ModerateDeletePostAsync(post, new("Reincidência"), Admin, default);
        Assert.Equal(409, await StatusAsync(() => guild.ModerateDeletePostAsync(post, new("De novo"), Admin, default)));
        Assert.Equal(["guild.report.remove", "guild.post.restore", "guild.post.delete"], await db.Audit.Where(a => a.Action.StartsWith("guild.")).OrderBy(a => a.Id).Select(a => a.Action).ToListAsync());
    }

    [Fact]
    public async Task Dismissing_keeps_the_post_and_audits()
    {
        var id = await TopicAsync();
        var post = await FirstPostAsync(id);
        var report = Prop<long>(await guild.ReportAsync(post, new("Não gostei do tom"), Other, default), "id");
        await guild.ResolveAsync(report, new("dismissed", "Sem violação das regras"), Admin, default);
        Assert.Null((await db.GuildPosts.AsNoTracking().SingleAsync(p => p.Id == post)).DeletedAt);
        Assert.Equal("dismissed", (await db.GuildReports.AsNoTracking().SingleAsync(r => r.Id == report)).Resolution);
        Assert.True(await db.Audit.AnyAsync(a => a.Action == "guild.report.dismiss" && a.ActorId == Admin));
    }

    [Fact]
    public async Task Author_deleting_the_only_post_removes_the_topic_but_not_when_there_are_replies()
    {
        var lonely = await TopicAsync();
        var first = await FirstPostAsync(lonely);
        Assert.Equal(404, await StatusAsync(() => guild.DeleteOwnAsync(first, Other, default)));
        Assert.True(Prop<bool>(await guild.DeleteOwnAsync(first, Common, default), "topicDeleted"));
        Assert.NotNull((await db.GuildTopics.AsNoTracking().SingleAsync(t => t.Id == lonely)).DeletedAt);
        Assert.Equal(404, await StatusAsync(() => guild.TopicAsync(lonely, Common, 1, default)));
        Assert.Equal(404, await StatusAsync(() => ReplyAsync(lonely, Other)));

        var busy = await TopicAsync();
        var opening = await FirstPostAsync(busy);
        var reply = await ReplyAsync(busy, Other);
        Assert.False(Prop<bool>(await guild.DeleteOwnAsync(opening, Common, default), "topicDeleted"));
        Assert.Null((await db.GuildTopics.AsNoTracking().SingleAsync(t => t.Id == busy)).DeletedAt);
        Assert.Equal(409, await StatusAsync(() => guild.DeleteOwnAsync(opening, Common, default)));
        var posts = Json(await guild.TopicAsync(busy, Veteran, 1, default)).GetProperty("posts");
        Assert.Equal("author", posts[0].GetProperty("removed").GetString());
        Assert.Equal(JsonValueKind.Null, posts[0].GetProperty("body").ValueKind);
        Assert.Equal(2, posts.GetArrayLength());
        // O autor não pode editar a mensagem removida; a resposta segue editável pelo autor dela.
        Assert.Equal(409, await StatusAsync(() => guild.EditAsync(opening, new("Voltei"), Common, default)));
        Assert.Equal(404, await StatusAsync(() => guild.EditAsync(reply, new("Não é meu"), Common, default)));
        var edited = await guild.EditAsync(reply, new("Resposta revisada", 0), Other, default);
        Assert.NotNull(Prop<DateTime?>(edited, "editedAt"));
        var revision = Prop<long>(edited, "revision");
        Assert.True(revision is > 0 and < 1L << 53, "revisão precisa ser exata em JavaScript");
        // Revisão desatualizada (0 = nunca editada) → 409; a revisão devolvida permite nova edição; sem revisão, última gravação vence.
        Assert.Equal(409, await StatusAsync(() => guild.EditAsync(reply, new("Edição antiga", 0), Other, default)));
        var again = await guild.EditAsync(reply, new("Segunda revisão", revision), Other, default);
        Assert.NotEqual(revision, Prop<long>(again, "revision"));
        await guild.EditAsync(reply, new("Sem revisão"), Other, default);
        var shown = Json(await guild.TopicAsync(busy, Other, 1, default)).GetProperty("posts")[1];
        Assert.Equal("Sem revisão", shown.GetProperty("body").GetString());
        Assert.Equal(GuildService.PostRevision((await db.GuildPosts.AsNoTracking().SingleAsync(p => p.Id == reply)).EditedAt), shown.GetProperty("revision").GetInt64());
        // Restaurar mensagem removida pelo próprio autor é recusado.
        Assert.Equal(409, await StatusAsync(() => guild.ModerateRestorePostAsync(opening, new("Tentativa"), Admin, default)));
    }

    [Fact]
    public async Task Topic_lists_pin_first_paginate_search_and_hide_uploaded_avatars_of_others()
    {
        for (var i = 0; i < 22; i++) await guild.CreateTopicAsync(new(Taverna, $"Tópico número {i:00}", "Corpo"), Veteran, default);
        var pinned = await TopicAsync(Common);
        await guild.ModerateTopicAsync(pinned, new(null, true, null, null, "Leitura recomendada", 1), Admin, default);
        await db.Users.Where(u => u.Id == Veteran).ExecuteUpdateAsync(s => s.SetProperty(u => u.AvatarUrl, "/api/auth/avatar/" + Guid.NewGuid()));

        var page1 = Json(await guild.TopicsAsync(Common, "taverna", null, null, 1, false, default));
        Assert.Equal(23, page1.GetProperty("total").GetInt32());
        Assert.Equal(20, page1.GetProperty("items").GetArrayLength());
        Assert.Equal(pinned, page1.GetProperty("items")[0].GetProperty("id").GetGuid());
        Assert.Equal("/assets/avatar.svg", page1.GetProperty("items")[1].GetProperty("author").GetProperty("avatarUrl").GetString());
        Assert.Equal(3, Json(await guild.TopicsAsync(Common, "taverna", null, null, 2, false, default)).GetProperty("items").GetArrayLength());
        Assert.Equal(1, Json(await guild.TopicsAsync(Common, null, "NÚMERO 07", null, 1, false, default)).GetProperty("total").GetInt32());
        Assert.Equal(404, await StatusAsync(() => guild.TopicsAsync(Common, "nao-existe", null, null, 1, false, default)));
        Assert.Equal(403, await StatusAsync(() => guild.TopicsAsync(Common, null, null, null, 1, true, default)));
        Assert.StartsWith("/api/auth/avatar/", Json(await guild.TopicsAsync(Veteran, "taverna", null, null, 1, false, default)).GetProperty("items")[1].GetProperty("author").GetProperty("avatarUrl").GetString());
        var recent = Json(await guild.RecentAsync(Common, 5, default));
        Assert.Equal(5, recent.GetArrayLength());
    }

    [Fact]
    public async Task Admin_manages_categories_and_cannot_delete_one_with_topics()
    {
        var input = new GuildCategoryInput("Contos", "contos", "Relatos de mesa", 9, 3, false);
        Assert.Equal(403, await StatusAsync(() => guild.CreateCategoryAsync(input, Ambassador, default)));
        Assert.Equal(400, await StatusAsync(() => guild.CreateCategoryAsync(input with { Slug = "Contos!" }, Admin, default)));
        Assert.Equal(400, await StatusAsync(() => guild.CreateCategoryAsync(input with { MinLevelToPost = 0 }, Admin, default)));
        Assert.Equal(409, await StatusAsync(() => guild.CreateCategoryAsync(input with { Slug = "taverna" }, Admin, default)));
        var id = Prop<Guid>(await guild.CreateCategoryAsync(input, Admin, default), "id");
        await guild.UpdateCategoryAsync(id, input with { Name = "Contos e lendas", MinLevelToPost = 1 }, Admin, default);
        Assert.Equal("Contos e lendas", (await db.GuildCategories.AsNoTracking().SingleAsync(c => c.Id == id)).Name);
        await TopicAsync(Common, id);
        Assert.Equal(409, await StatusAsync(() => guild.DeleteCategoryAsync(id, Admin, default)));
        await guild.UpdateCategoryAsync(id, input with { Archived = true }, Admin, default);
        Assert.DoesNotContain(Json(await guild.CategoriesAsync(Common, default)).GetProperty("items").EnumerateArray(), c => c.GetProperty("slug").GetString() == "contos");
        Assert.Equal(409, await StatusAsync(() => TopicAsync(Common, id)));
        var empty = Prop<Guid>(await guild.CreateCategoryAsync(input with { Slug = "vazia" }, Admin, default), "id");
        await guild.DeleteCategoryAsync(empty, Admin, default);
        Assert.Equal(["guild.category.create", "guild.category.update", "guild.category.archive", "guild.category.create", "guild.category.delete"],
            await db.Audit.OrderBy(a => a.Id).Select(a => a.Action).ToListAsync());
    }
}
