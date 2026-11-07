using System.Text.Json;
using Eternnus.Web;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace Eternnus.Tests;

/// <summary>Regras de suporte em SQLite. Bloqueios de linha e a política HTTP (403 para não admin) são cobertos por tests/support.mjs em PostgreSQL.</summary>
public sealed class SupportTests : IAsyncLifetime
{
    readonly SqliteConnection connection = new("Data Source=:memory:");
    readonly ManualClock clock = new(new DateTimeOffset(2026, 11, 7, 12, 0, 0, TimeSpan.Zero));
    GameDb db = null!;
    SupportService service = null!;
    const string Author = "author", Other = "other", Admin = "admin", Ambassador = "ambassador", Pending = "pending-admin";

    public async Task InitializeAsync()
    {
        await connection.OpenAsync();
        db = NewDb();
        await db.Database.EnsureCreatedAsync();
        db.Users.AddRange(
            User(Author, "Ana", PlatformRoles.Common),
            User(Other, "Bruno", PlatformRoles.Common),
            User(Admin, "Clara", PlatformRoles.Admin),
            User(Ambassador, "Davi", PlatformRoles.Ambassador),
            User(Pending, "Pendente", PlatformRoles.Admin, confirmed: false));
        await db.SaveChangesAsync();
        service = Service(db);
    }
    public async Task DisposeAsync() { await db.DisposeAsync(); await connection.DisposeAsync(); }

    GameDb NewDb(params IInterceptor[] interceptors) =>
        new(new DbContextOptionsBuilder<GameDb>().UseSqlite(connection).AddInterceptors(interceptors).Options);
    SupportService Service(GameDb context) => new(context, new AuditService(context), clock);
    static AppUser User(string id, string name, string role, bool confirmed = true) =>
        new() { Id = id, UserName = id, Email = id + "@example.test", DisplayName = name, Role = role, EmailConfirmed = confirmed };
    static T Prop<T>(object o, string name) => (T)o.GetType().GetProperty(name)!.GetValue(o)!;
    static readonly JsonSerializerOptions Plain = new() { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping };
    static string Json(object o) => JsonSerializer.Serialize(o, Plain);
    static async Task<int> Status(Func<Task> action) => (await Assert.ThrowsAsync<RuleException>(action)).Status;

    async Task<Guid> CreateAsync(string user = Author, string subject = "Não consigo entrar", string category = TicketCategories.Account) =>
        Prop<Guid>(await service.CreateAsync(user, new(subject, category, "Descrição detalhada do problema."), default), "Id");
    async Task<SupportTicket> TicketAsync(Guid id) => await db.Tickets.AsNoTracking().SingleAsync(x => x.Id == id);
    async Task<int> RevisionAsync(Guid id) => (await TicketAsync(id)).Revision;
    async Task UpdateAsync(Guid id, string status, string priority = TicketPriorities.Normal, string? assignee = null) =>
        await service.UpdateAsync(Admin, id, new(status, priority, assignee, await RevisionAsync(id)), default);

    [Fact]
    public async Task Tickets_get_sequential_numbers_and_the_first_message_in_the_same_save()
    {
        var a = await service.CreateAsync(Author, new("  Primeiro  ", TicketCategories.Bug, "Linha 1\r\nLinha 2 com detalhes"), default);
        var b = await service.CreateAsync(Other, new("Segundo", TicketCategories.Other, "Outra descrição longa"), default);
        Assert.Equal(1, Prop<int>(a, "Number"));
        Assert.Equal(2, Prop<int>(b, "Number"));
        var first = await TicketAsync(Prop<Guid>(a, "Id"));
        Assert.Equal("Primeiro", first.Subject);
        Assert.Equal(TicketStatuses.Open, first.Status);
        Assert.Equal(TicketPriorities.Normal, first.Priority);
        var message = await db.TicketMessages.SingleAsync(m => m.TicketId == first.Id);
        Assert.Equal("Linha 1\nLinha 2 com detalhes", message.Body);
        Assert.False(message.Internal);
        Assert.Equal(Author, message.AuthorId);
    }

    [Fact]
    public async Task Creation_validates_subject_category_and_body()
    {
        Assert.Equal(400, await Status(() => service.CreateAsync(Author, new("ab", TicketCategories.Bug, "Descrição suficiente"), default)));
        Assert.Equal(400, await Status(() => service.CreateAsync(Author, new(new string('x', 121), TicketCategories.Bug, "Descrição suficiente"), default)));
        Assert.Equal(400, await Status(() => service.CreateAsync(Author, new("Assunto\u0007", TicketCategories.Bug, "Descrição suficiente"), default)));
        Assert.Equal(400, await Status(() => service.CreateAsync(Author, new("Assunto", "hack", "Descrição suficiente"), default)));
        Assert.Equal(400, await Status(() => service.CreateAsync(Author, new("Assunto", null, "Descrição suficiente"), default)));
        Assert.Equal(400, await Status(() => service.CreateAsync(Author, new("Assunto", TicketCategories.Bug, "curta"), default)));
        Assert.Equal(400, await Status(() => service.CreateAsync(Author, new("Assunto", TicketCategories.Bug, new string('x', 5001)), default)));
        Assert.Equal(0, await db.Tickets.CountAsync());
    }

    sealed class CollidingNumbers(int collisions) : SaveChangesInterceptor
    {
        public int Remaining = collisions;
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            // Simula outro processo que gravou o mesmo MAX+1 entre a leitura e a gravação.
            foreach (var entry in eventData.Context!.ChangeTracker.Entries<SupportTicket>().Where(e => e.State == EntityState.Added))
                if (Remaining-- > 0) entry.Entity.Number = 1;
            return base.SavingChangesAsync(eventData, result, cancellationToken);
        }
    }

    [Fact]
    public async Task A_number_collision_is_retried_and_gives_up_after_five_attempts()
    {
        await CreateAsync();
        var interceptor = new CollidingNumbers(2);
        await using (var racing = NewDb(interceptor))
        {
            var created = await Service(racing).CreateAsync(Other, new("Corrida", TicketCategories.Bug, "Descrição da corrida"), default);
            Assert.Equal(2, Prop<int>(created, "Number"));
        }
        Assert.True(interceptor.Remaining <= 0);
        Assert.Equal(2, await db.Tickets.CountAsync());
        Assert.Equal(2, await db.TicketMessages.CountAsync());

        await using (var hopeless = NewDb(new CollidingNumbers(int.MaxValue)))
            Assert.Equal(409, await Status(() => Service(hopeless).CreateAsync(Other, new("Sem sorte", TicketCategories.Bug, "Descrição da corrida"), default)));
        Assert.Equal(2, await db.Tickets.CountAsync());
        Assert.Equal(2, await db.TicketMessages.CountAsync());
    }

    [Fact]
    public async Task A_user_keeps_at_most_five_open_tickets()
    {
        var ids = new List<Guid>();
        for (var i = 0; i < SupportRules.MaxOpenPerUser; i++) ids.Add(await CreateAsync(subject: "Chamado " + i));
        var limit = await Assert.ThrowsAsync<RuleException>(() => CreateAsync(subject: "Sexto"));
        Assert.Equal(400, limit.Status);
        Assert.Contains("5 chamados em aberto", limit.Message);
        // Outro usuário não é afetado; concluídos não contam.
        await CreateAsync(Other);
        await service.CloseAsync(Author, ids[0], default);
        var sixth = await CreateAsync(subject: "Agora cabe");
        Assert.Equal(400, await Status(() => service.ReopenAsync(Author, ids[0], default)));
        await UpdateAsync(sixth, TicketStatuses.Resolved);
        await service.ReopenAsync(Author, ids[0], default);
        var list = await service.MyTicketsAsync(Author, null, 1, default);
        Assert.Equal(5, Prop<int>(list, "openCount"));
        Assert.Equal(6, Prop<int>(list, "total"));
        Assert.Equal(5, Prop<int>(await service.MyTicketsAsync(Author, SupportRules.ActiveFilter, 1, default), "total"));
        Assert.Equal(400, await Status(() => service.MyTicketsAsync(Author, "bogus", 1, default)));
    }

    [Fact]
    public async Task Status_transitions_follow_the_conversation_and_keep_closed_at_coherent()
    {
        var id = await CreateAsync();
        await service.StaffMessageAsync(Admin, id, new("Pode enviar um print?", false), default);
        Assert.Equal(TicketStatuses.WaitingUser, (await TicketAsync(id)).Status);
        await service.ReplyAsync(Author, id, new("Segue o print."), default);
        Assert.Equal(TicketStatuses.Open, (await TicketAsync(id)).Status);

        // Nota interna não muda o status.
        await UpdateAsync(id, TicketStatuses.InProgress);
        await service.StaffMessageAsync(Admin, id, new("Investigando o banco", true), default);
        Assert.Equal(TicketStatuses.InProgress, (await TicketAsync(id)).Status);

        await UpdateAsync(id, TicketStatuses.Resolved);
        var resolved = await TicketAsync(id);
        Assert.Equal(clock.GetUtcNow().UtcDateTime, resolved.ClosedAt);
        // Resposta da equipe em ticket resolvido não altera o status.
        await service.StaffMessageAsync(Admin, id, new("Qualquer coisa, é só responder.", false), default);
        Assert.Equal(TicketStatuses.Resolved, (await TicketAsync(id)).Status);

        await service.ReplyAsync(Author, id, new("Voltou a acontecer."), default);
        var reopened = await TicketAsync(id);
        Assert.Equal(TicketStatuses.Open, reopened.Status);
        Assert.Null(reopened.ClosedAt);

        await service.CloseAsync(Author, id, default);
        Assert.Equal(409, await Status(() => service.CloseAsync(Author, id, default)));
        var reply = await Assert.ThrowsAsync<RuleException>(() => service.ReplyAsync(Author, id, new("Oi?"), default));
        Assert.Equal(409, reply.Status);
        Assert.Contains("Reabra", reply.Message);
        Assert.False(Prop<bool>(await service.MyTicketAsync(Author, id, default), "canReply"));

        clock.Advance(TimeSpan.FromDays(29));
        Assert.True(Prop<bool>(await service.MyTicketAsync(Author, id, default), "canReopen"));
        await service.ReopenAsync(Author, id, default);
        Assert.Equal(409, await Status(() => service.ReopenAsync(Author, id, default)));
        Assert.Null((await TicketAsync(id)).ClosedAt);

        await service.CloseAsync(Author, id, default);
        clock.Advance(TimeSpan.FromDays(SupportRules.ReopenDays));
        Assert.False(Prop<bool>(await service.MyTicketAsync(Author, id, default), "canReopen"));
        Assert.Equal(409, await Status(() => service.ReopenAsync(Author, id, default)));

        // Cada mudança automática virou nota interna; o usuário não as recebe.
        var notes = await db.TicketMessages.Where(m => m.TicketId == id && m.Internal).OrderBy(m => m.Id).Select(m => m.Body).ToListAsync();
        Assert.Contains("Status: Aberto → Aguardando usuário (resposta da equipe)", notes);
        Assert.Contains("Status: Aguardando usuário → Aberto (resposta do usuário)", notes);
        Assert.Contains("Status: Aberto → Em andamento", notes);
        Assert.Contains("Status: Resolvido → Aberto (resposta do usuário)", notes);
        Assert.Contains("Status: Aberto → Fechado (fechado pelo usuário)", notes);
        Assert.Contains("Status: Fechado → Aberto (reaberto pelo usuário)", notes);
        Assert.DoesNotContain("Status:", Json(await service.MyTicketAsync(Author, id, default)));
    }

    [Fact]
    public async Task Internal_notes_and_emails_never_reach_the_author()
    {
        var id = await CreateAsync();
        await service.StaffMessageAsync(Admin, id, new("Segredo da equipe", true), default);
        await service.StaffMessageAsync(Admin, id, new("Olá! Já estamos vendo.", false), default);
        var mine = await service.MyTicketAsync(Author, id, default);
        var json = Json(mine);
        Assert.DoesNotContain("Segredo da equipe", json);
        Assert.DoesNotContain("@example.test", json);
        Assert.Contains("Olá! Já estamos vendo.", json);
        var messages = Prop<System.Collections.IEnumerable>(mine, "messages").Cast<object>().ToList();
        Assert.Equal(2, messages.Count);
        Assert.False(Prop<bool>(messages[0], "fromStaff"));
        Assert.True(Prop<bool>(messages[0], "mine"));
        Assert.True(Prop<bool>(messages[1], "fromStaff"));
        Assert.Contains("Clara", Json(messages[1]));

        var staffView = Json(await service.AdminTicketAsync(Admin, id, default));
        Assert.Contains("Segredo da equipe", staffView);
        Assert.Contains("author@example.test", staffView);
        Assert.DoesNotContain("@example.test", Json(await service.QueueAsync(Admin, new(null, null, null, null, null, 1), default)));
        var list = Json(await service.MyTicketsAsync(Author, null, 1, default));
        Assert.Contains("\"messageCount\":2", list);
        Assert.Contains("\"lastFromStaff\":true", list);
    }

    [Fact]
    public async Task Tickets_of_another_user_are_not_found()
    {
        var id = await CreateAsync();
        Assert.Equal(404, await Status(() => service.MyTicketAsync(Other, id, default)));
        Assert.Equal(404, await Status(() => service.ReplyAsync(Other, id, new("Intrometido"), default)));
        Assert.Equal(404, await Status(() => service.CloseAsync(Other, id, default)));
        Assert.Equal(404, await Status(() => service.ReopenAsync(Other, id, default)));
        // Nem o admin lê pelo caminho do usuário: ele usa a fila.
        Assert.Equal(404, await Status(() => service.MyTicketAsync(Admin, id, default)));
        Assert.Equal(0, Prop<int>(await service.MyTicketsAsync(Other, null, 1, default), "total"));
        Assert.Equal(404, await Status(() => service.MyTicketAsync(Author, Guid.NewGuid(), default)));
        Assert.Equal(TicketStatuses.Open, (await TicketAsync(id)).Status);
    }

    [Fact]
    public async Task Staff_updates_require_the_current_revision()
    {
        var id = await CreateAsync();
        var revision = await RevisionAsync(id);
        await service.UpdateAsync(Admin, id, new(TicketStatuses.InProgress, TicketPriorities.High, null, revision), default);
        var stale = await Assert.ThrowsAsync<RuleException>(() => service.UpdateAsync(Admin, id, new(TicketStatuses.Resolved, TicketPriorities.High, null, revision), default));
        Assert.Equal(409, stale.Status);
        // Uma resposta do usuário também invalida a revisão que a equipe tinha aberto.
        var current = await RevisionAsync(id);
        await service.ReplyAsync(Author, id, new("Mais detalhes"), default);
        Assert.Equal(409, await Status(() => service.UpdateAsync(Admin, id, new(TicketStatuses.Resolved, TicketPriorities.High, null, current), default)));
        var ticket = await TicketAsync(id);
        Assert.Equal(TicketStatuses.InProgress, ticket.Status);
        Assert.Equal(TicketPriorities.High, ticket.Priority);
        Assert.Equal(400, await Status(() => service.UpdateAsync(Admin, id, new("done", TicketPriorities.High, null, ticket.Revision), default)));
        Assert.Equal(400, await Status(() => service.UpdateAsync(Admin, id, new(TicketStatuses.Open, "max", null, ticket.Revision), default)));
    }

    [Fact]
    public async Task Tickets_are_assigned_only_to_staff_and_every_change_is_audited()
    {
        var id = await CreateAsync();
        Assert.Equal(400, await Status(() => UpdateAsync(id, TicketStatuses.Open, assignee: Other)));
        Assert.Equal(400, await Status(() => UpdateAsync(id, TicketStatuses.Open, assignee: Pending)));
        Assert.Equal(400, await Status(() => UpdateAsync(id, TicketStatuses.Open, assignee: "ghost")));
        Assert.Equal(0, await db.Audit.CountAsync());

        await UpdateAsync(id, TicketStatuses.InProgress, TicketPriorities.Urgent, Ambassador);
        Assert.Equal(Ambassador, (await TicketAsync(id)).AssignedToId);
        await UpdateAsync(id, TicketStatuses.InProgress, TicketPriorities.Urgent, Admin);
        var before = await RevisionAsync(id);
        await UpdateAsync(id, TicketStatuses.InProgress, TicketPriorities.Urgent, null);
        Assert.Null((await TicketAsync(id)).AssignedToId);
        // Sem mudança: nada é gravado nem auditado.
        await UpdateAsync(id, TicketStatuses.InProgress, TicketPriorities.Urgent, null);
        Assert.Equal(before + 1, await RevisionAsync(id));

        var audit = await db.Audit.OrderBy(a => a.Id).ToListAsync();
        Assert.Equal(3, audit.Count);
        Assert.All(audit, a => { Assert.Equal("ticket.update", a.Action); Assert.Equal(Admin, a.ActorId); Assert.Equal(id.ToString(), a.TargetId); });
        Assert.Contains("Prioridade: Normal → Urgente", audit[0].Summary);
        Assert.DoesNotContain("@", string.Concat(audit.Select(a => a.Data + a.Summary)));
        var notes = await db.TicketMessages.Where(m => m.TicketId == id && m.Internal).Select(m => m.Body).ToListAsync();
        Assert.Contains("Atribuição: ninguém → Davi", notes);
        Assert.Contains("Atribuição: Davi → Clara", notes);
        Assert.Contains("Atribuição: Clara → ninguém", notes);
        Assert.Contains("Prioridade: Normal → Urgente", notes);

        await service.StaffMessageAsync(Admin, id, new("Resposta", false), default);
        Assert.Equal("ticket.reply", (await db.Audit.OrderBy(a => a.Id).LastAsync()).Action);
        var assignees = Json(await service.AssigneesAsync(Admin, default));
        Assert.Contains("Clara", assignees); Assert.Contains("Davi", assignees);
        Assert.DoesNotContain("Bruno", assignees); Assert.DoesNotContain("Pendente", assignees); Assert.DoesNotContain("@", assignees);
    }

    [Fact]
    public async Task Only_confirmed_admins_use_the_staff_operations()
    {
        var id = await CreateAsync();
        foreach (var user in new[] { Ambassador, Author, Pending })
        {
            Assert.Equal(403, await Status(() => service.QueueAsync(user, new(null, null, null, null, null, 1), default)));
            Assert.Equal(403, await Status(() => service.AdminTicketAsync(user, id, default)));
            Assert.Equal(403, await Status(() => service.StaffMessageAsync(user, id, new("x", false), default)));
            Assert.Equal(403, await Status(() => service.UpdateAsync(user, id, new(TicketStatuses.Closed, TicketPriorities.Low, null, 1), default)));
            Assert.Equal(403, await Status(() => service.AssigneesAsync(user, default)));
        }
        Assert.Equal(404, await Status(() => service.AdminTicketAsync(Admin, Guid.NewGuid(), default)));
    }

    [Fact]
    public async Task The_queue_orders_by_priority_then_activity_and_filters()
    {
        var low = await CreateAsync(subject: "Baixa prioridade");
        clock.Advance(TimeSpan.FromMinutes(1));
        var urgent = await CreateAsync(Other, "Tudo caiu", TicketCategories.Bug);
        clock.Advance(TimeSpan.FromMinutes(1));
        var normalOld = await CreateAsync(subject: "Normal antigo");
        clock.Advance(TimeSpan.FromMinutes(1));
        var normalNew = await CreateAsync(Other, "Normal recente");
        clock.Advance(TimeSpan.FromMinutes(1));
        await UpdateAsync(low, TicketStatuses.Open, TicketPriorities.Low);
        await UpdateAsync(urgent, TicketStatuses.InProgress, TicketPriorities.Urgent, Admin);
        clock.Advance(TimeSpan.FromMinutes(1));
        await service.ReplyAsync(Author, normalOld, new("Atualizando"), default);

        static List<Guid> Ids(object page) => Prop<System.Collections.IEnumerable>(page, "items").Cast<object>().Select(i => Prop<Guid>(i, "Id")).ToList();
        var all = await service.QueueAsync(Admin, new(null, null, null, null, null, 1), default);
        Assert.Equal([urgent, normalOld, normalNew, low], Ids(all));
        Assert.Equal(3, Prop<Dictionary<string, int>>(all, "counts")[TicketStatuses.Open]);
        Assert.Equal(1, Prop<int>(all, "mine"));
        Assert.Equal([urgent], Ids(await service.QueueAsync(Admin, new(null, null, null, "me", null, 1), default)));
        Assert.Equal([normalOld, normalNew, low], Ids(await service.QueueAsync(Admin, new(null, null, null, "none", null, 1), default)));
        Assert.Equal([urgent], Ids(await service.QueueAsync(Admin, new(TicketStatuses.InProgress, null, null, null, null, 1), default)));
        Assert.Equal([urgent], Ids(await service.QueueAsync(Admin, new(null, TicketPriorities.Urgent, TicketCategories.Bug, null, null, 1), default)));
        Assert.Equal([normalOld], Ids(await service.QueueAsync(Admin, new(null, null, null, null, "#3", 1), default)));
        Assert.Equal([normalOld, normalNew], Ids(await service.QueueAsync(Admin, new(null, null, null, null, "NORMAL", 1), default)));
        Assert.Equal(400, await Status(() => service.QueueAsync(Admin, new(null, null, null, "everyone", null, 1), default)));
        Assert.Equal(400, await Status(() => service.QueueAsync(Admin, new(null, "max", null, null, null, 1), default)));
        Assert.Equal(400, await Status(() => service.QueueAsync(Admin, new(null, null, "x", null, null, 1), default)));
    }

    [Fact]
    public void Pure_rules_describe_reply_effects_and_closing_time()
    {
        var now = new DateTime(2026, 11, 7, 12, 0, 0, DateTimeKind.Utc);
        Assert.Equal(TicketStatuses.Open, SupportRules.AfterUserReply(TicketStatuses.WaitingUser));
        Assert.Equal(TicketStatuses.Open, SupportRules.AfterUserReply(TicketStatuses.Resolved));
        Assert.Equal(TicketStatuses.InProgress, SupportRules.AfterUserReply(TicketStatuses.InProgress));
        Assert.Equal(TicketStatuses.WaitingUser, SupportRules.AfterStaffReply(TicketStatuses.Open));
        Assert.Equal(TicketStatuses.WaitingUser, SupportRules.AfterStaffReply(TicketStatuses.InProgress));
        Assert.Equal(TicketStatuses.Closed, SupportRules.AfterStaffReply(TicketStatuses.Closed));
        Assert.Null(SupportRules.ClosedAtFor(TicketStatuses.Closed, TicketStatuses.Open, now.AddDays(-1), now));
        Assert.Equal(now, SupportRules.ClosedAtFor(TicketStatuses.Open, TicketStatuses.Resolved, null, now));
        Assert.Equal(now, SupportRules.ClosedAtFor(TicketStatuses.Resolved, TicketStatuses.Closed, now.AddDays(-2), now));
        Assert.Equal(now.AddDays(-2), SupportRules.ClosedAtFor(TicketStatuses.Closed, TicketStatuses.Closed, now.AddDays(-2), now));
        Assert.True(SupportRules.CanReopen(TicketStatuses.Resolved, now.AddDays(-29), now));
        Assert.False(SupportRules.CanReopen(TicketStatuses.Closed, now.AddDays(-30), now));
        Assert.False(SupportRules.CanReopen(TicketStatuses.Open, null, now));
    }

    sealed class ManualClock(DateTimeOffset start) : TimeProvider
    {
        DateTimeOffset now = start;
        public override DateTimeOffset GetUtcNow() => now;
        public void Advance(TimeSpan by) => now += by;
    }
}
