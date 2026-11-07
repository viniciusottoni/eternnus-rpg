using Eternnus.Web;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace Eternnus.Tests;

/// <summary>Regras de papéis, sistemas de RPG e campanhas (visão admin) em SQLite.
/// Bloqueios reais, suspensão derrubando sessão e 403 por política são cobertos por tests/admin.mjs em PostgreSQL.</summary>
public sealed class AdminTests : IAsyncLifetime
{
    readonly SqliteConnection connection = new("Data Source=:memory:");
    GameDb db = null!;
    AuditService audit = null!;
    AdminService admin = null!;
    RpgSystemService systems = null!;
    CampaignService campaigns = null!;
    const string Root = "root", Ambassador = "amb", Common = "common", Pending = "pending";

    public async Task InitializeAsync()
    {
        await connection.OpenAsync();
        db = new GameDb(new DbContextOptionsBuilder<GameDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        AddUser(Root, PlatformRoles.Admin); AddUser(Ambassador, PlatformRoles.Ambassador); AddUser(Common, PlatformRoles.Common);
        AddUser(Pending, PlatformRoles.Common, confirmed: false);
        await db.SaveChangesAsync();
        audit = new AuditService(db);
        var users = new UserManager<AppUser>(new UserStore<AppUser>(db), Options.Create(new IdentityOptions()), new PasswordHasher<AppUser>(), [], [],
            new UpperInvariantLookupNormalizer(), new IdentityErrorDescriber(), null!, NullLogger<UserManager<AppUser>>.Instance);
        admin = new AdminService(db, audit, users);
        systems = new RpgSystemService(db, audit);
        campaigns = new CampaignService(db, new ProgressionService(db, audit), audit);
    }
    void AddUser(string id, string role, bool confirmed = true) =>
        db.Users.Add(new AppUser { Id = id, UserName = id, Email = id + "@example.test", NormalizedEmail = (id + "@example.test").ToUpperInvariant(), DisplayName = id, Role = role, EmailConfirmed = confirmed, SecurityStamp = Guid.NewGuid().ToString() });
    public async Task DisposeAsync() { await db.DisposeAsync(); await connection.DisposeAsync(); }

    static async Task<int> Status(Func<Task> action) => (await Assert.ThrowsAsync<RuleException>(action)).Status;
    async Task<AppUser> Fresh(string id) { db.ChangeTracker.Clear(); return await db.Users.AsNoTracking().SingleAsync(u => u.Id == id); }
    static T Prop<T>(object o, string name) => (T)o.GetType().GetProperty(name)!.GetValue(o)!;

    [Theory]
    [InlineData("Tormenta20", "tormenta20")]
    [InlineData("  D&D 5ª Edição ", "d-d-5-edicao")]
    [InlineData("Ação — Épica!!", "acao-epica")]
    [InlineData("3D&T Alpha", "3d-t-alpha")]
    public void Slugs_are_lowercase_ascii_with_single_hyphens(string name, string expected)
    {
        Assert.Equal(expected, RpgSystemService.Slugify(name));
        Assert.True(RpgSystemService.IsValidSlug(expected));
    }

    [Theory]
    [InlineData("")]
    [InlineData("Maiuscula")]
    [InlineData("com espaco")]
    [InlineData("-inicio")]
    [InlineData("fim-")]
    [InlineData("duplo--hifen")]
    [InlineData("acentuação")]
    public void Invalid_slugs_are_rejected(string slug) => Assert.False(RpgSystemService.IsValidSlug(slug));

    [Fact]
    public async Task Systems_require_unique_name_and_slug_and_validate_input()
    {
        var created = await systems.CreateAsync(new("Tormenta20", null, "Fantasia brasileira"), Root, default);
        Assert.Equal("tormenta20", Prop<string>(created, "Slug"));
        Assert.Equal(409, await Status(() => systems.CreateAsync(new("tormenta20", "outro", ""), Root, default)));
        Assert.Equal(409, await Status(() => systems.CreateAsync(new("Outro nome", "tormenta20", ""), Root, default)));
        Assert.Equal(400, await Status(() => systems.CreateAsync(new("Nome", "Slug Inválido", ""), Root, default)));
        Assert.Equal(400, await Status(() => systems.CreateAsync(new("X", null, ""), Root, default)));
        Assert.Equal(400, await Status(() => systems.CreateAsync(new("Longo", null, new string('a', 2001)), Root, default)));
        Assert.Equal(1, await db.Audit.CountAsync(a => a.Action == "system.create" && a.ActorId == Root));
    }

    [Fact]
    public async Task Free_system_is_protected_against_delete_and_deactivation()
    {
        Assert.Equal(409, await Status(() => systems.DeleteAsync(RpgSystem.FreeSystemId, Root, default)));
        var free = await db.RpgSystems.AsNoTracking().SingleAsync(s => s.Id == RpgSystem.FreeSystemId);
        Assert.Equal(409, await Status(() => systems.UpdateAsync(free.Id, new(free.Name, free.Slug, free.Description, false, free.Revision), Root, default)));
        // Renomear continua permitido (e não desativa).
        await systems.UpdateAsync(free.Id, new("Livre", free.Slug, free.Description, true, free.Revision), Root, default);
        Assert.True((await db.RpgSystems.AsNoTracking().SingleAsync(s => s.Id == free.Id)).Active);
    }

    [Fact]
    public async Task Stale_revision_conflicts_and_rename_updates_campaign_text()
    {
        var id = Prop<Guid>(await systems.CreateAsync(new("Tormenta20", null, ""), Root, default), "Id");
        var campaign = await campaigns.CreateAsync(new("Arton", "", RpgSystemId: id), Common, default);
        await systems.UpdateAsync(id, new("Tormenta 20", "tormenta20", "", true, 1), Root, default);
        db.ChangeTracker.Clear();
        Assert.Equal("Tormenta 20", (await db.Campaigns.AsNoTracking().SingleAsync(c => c.Id == campaign)).System);
        Assert.Equal(409, await Status(() => systems.UpdateAsync(id, new("Tormenta", "tormenta20", "", true, 1), Root, default)));
        // Em uso: não pode excluir.
        Assert.Equal(409, await Status(() => systems.DeleteAsync(id, Root, default)));
        var unused = Prop<Guid>(await systems.CreateAsync(new("GURPS", null, ""), Root, default), "Id");
        await systems.DeleteAsync(unused, Root, default);
        Assert.False(await db.RpgSystems.AnyAsync(s => s.Id == unused));
        Assert.True(await db.Audit.AnyAsync(a => a.Action == "system.delete" && a.TargetId == unused.ToString()));
    }

    [Fact]
    public async Task Campaign_system_requires_explicit_valid_selection_and_keeps_existing_inactive_system()
    {
        // O teste cria várias campanhas com o mesmo mestre: nível suficiente para o desbloqueio de campanhas extras (WP8).
        await db.Users.Where(u => u.Id == Common).ExecuteUpdateAsync(s => s.SetProperty(u => u.Level, 10));
        var t20 = Prop<Guid>(await systems.CreateAsync(new("Tormenta20", null, ""), Root, default), "Id");
        var byName = await campaigns.CreateAsync(new("Por nome", "", "  tormenta20 "), Common, default);
        Assert.Equal(400, await Status(() => campaigns.CreateAsync(new("Desconhecido", "", "Sistema caseiro"), Common, default)));
        Assert.Equal(400, await Status(() => campaigns.CreateAsync(new("Vazio", ""), Common, default)));
        var unknown = await campaigns.CreateAsync(new("Livre", "", RpgSystemId: RpgSystem.FreeSystemId), Common, default);
        var byId = await campaigns.CreateAsync(new("Por id", "", "ignorado", 0, t20), Common, default);
        db.ChangeTracker.Clear();
        var all = await db.Campaigns.AsNoTracking().ToDictionaryAsync(c => c.Id);
        Assert.Equal((t20, "Tormenta20"), (all[byName].RpgSystemId, all[byName].System));
        Assert.Equal((RpgSystem.FreeSystemId, "Sistema livre"), (all[unknown].RpgSystemId, all[unknown].System));
        Assert.Equal(t20, all[byId].RpgSystemId);
        Assert.Equal(400, await Status(() => campaigns.CreateAsync(new("Fantasma", "", null, 0, Guid.NewGuid()), Common, default)));

        // Sistema desativado: não serve para criar, mas a campanha que já o usa pode mantê-lo ao editar (por id ou pelo texto antigo).
        var system = await db.RpgSystems.AsNoTracking().SingleAsync(s => s.Id == t20);
        await systems.UpdateAsync(t20, new(system.Name, system.Slug, "", false, system.Revision), Root, default);
        Assert.Equal(400, await Status(() => campaigns.CreateAsync(new("Nova", "", null, 0, t20), Common, default)));
        Assert.Equal(400, await Status(() => campaigns.CreateAsync(new("Nova por nome", "", "Tormenta20"), Common, default)));
        await campaigns.UpdateAsync(byId, new("Por id editada", "", null, 1, t20), Common, default);
        await campaigns.UpdateAsync(byName, new("Por nome editada", "", "Tormenta20", 1), Common, default);
        db.ChangeTracker.Clear();
        Assert.Equal(t20, (await db.Campaigns.AsNoTracking().SingleAsync(c => c.Id == byId)).RpgSystemId);
        Assert.Equal(t20, (await db.Campaigns.AsNoTracking().SingleAsync(c => c.Id == byName)).RpgSystemId);
        // Outra campanha não pode adotar o sistema inativo.
        Assert.Equal(400, await Status(() => campaigns.UpdateAsync(unknown, new("Desconhecido", "", null, 1, t20), Common, default)));
    }

    [Fact]
    public async Task Role_changes_validate_role_and_never_leave_the_platform_without_admin()
    {
        Assert.Equal(400, await Status(() => admin.SetRoleAsync(Common, new("owner", "motivo válido"), Root, default)));
        Assert.Equal(400, await Status(() => admin.SetRoleAsync(Common, new(PlatformRoles.Ambassador, ""), Root, default)));
        Assert.Equal(404, await Status(() => admin.SetRoleAsync("ninguem", new(PlatformRoles.Ambassador, "motivo válido"), Root, default)));
        // Auto-rebaixamento é proibido mesmo havendo outros admins.
        Assert.Equal(409, await Status(() => admin.SetRoleAsync(Root, new(PlatformRoles.Common, "quero sair"), Root, default)));
        // Conta sem e-mail confirmado não vira equipe.
        Assert.Equal(409, await Status(() => admin.SetRoleAsync(Pending, new(PlatformRoles.Ambassador, "motivo válido"), Root, default)));

        await admin.SetRoleAsync(Common, new(PlatformRoles.Admin, "Nova moderadora"), Root, default);
        Assert.Equal(PlatformRoles.Admin, (await Fresh(Common)).Role);
        var entry = await db.Audit.AsNoTracking().SingleAsync(a => a.Action == "user.role" && a.TargetId == Common);
        Assert.Contains("\"before\":{\"role\":\"common\"}", entry.Data);
        Assert.Contains("\"after\":{\"role\":\"admin\"}", entry.Data);
        Assert.Equal(Root, entry.ActorId);

        // O novo admin rebaixa o antigo; depois não há como rebaixar o último admin restante.
        await admin.SetRoleAsync(Root, new(PlatformRoles.Ambassador, "Troca de função"), Common, default);
        db.ChangeTracker.Clear();
        Assert.Equal(PlatformRoles.Ambassador, (await Fresh(Root)).Role);
        Assert.Equal(1, await db.Users.CountAsync(u => u.Role == PlatformRoles.Admin));
        // Mesmo papel: nada muda e nada é auditado.
        await admin.SetRoleAsync(Root, new(PlatformRoles.Ambassador, "repetido"), Common, default);
        Assert.Equal(2, await db.Audit.CountAsync(a => a.Action == "user.role"));
    }

    [Fact]
    public async Task Last_admin_cannot_be_demoted_by_anyone()
    {
        // Simula um segundo admin sem e-mail confirmado e tenta rebaixar o único admin válido a partir dele.
        await db.Users.Where(u => u.Id == Pending).ExecuteUpdateAsync(u => u.SetProperty(x => x.Role, PlatformRoles.Admin));
        db.ChangeTracker.Clear();
        Assert.Equal(409, await Status(() => admin.SetRoleAsync(Root, new(PlatformRoles.Common, "tentativa"), Pending, default)));
        Assert.Equal(PlatformRoles.Admin, (await Fresh(Root)).Role);
    }

    [Fact]
    public async Task Suspension_rules_and_security_stamp()
    {
        Assert.Equal(409, await Status(() => admin.SuspendAsync(Root, new(null, "auto suspensão"), Root, default)));
        await db.Users.Where(u => u.Id == Ambassador).ExecuteUpdateAsync(u => u.SetProperty(x => x.Role, PlatformRoles.Admin));
        db.ChangeTracker.Clear();
        Assert.Equal(409, await Status(() => admin.SuspendAsync(Ambassador, new(null, "outro admin"), Root, default)));
        Assert.Equal(400, await Status(() => admin.SuspendAsync(Common, new(DateTime.UtcNow.AddDays(-1), "data passada"), Root, default)));
        Assert.Equal(400, await Status(() => admin.SuspendAsync(Common, new(null, "x"), Root, default)));

        var stamp = (await Fresh(Common)).SecurityStamp;
        db.ChangeTracker.Clear();
        await admin.SuspendAsync(Common, new(DateTime.UtcNow.AddDays(3), "Spam na Guilda"), Root, default);
        var suspended = await Fresh(Common);
        Assert.True(suspended.LockoutEnabled);
        Assert.True(suspended.LockoutEnd > DateTimeOffset.UtcNow.AddDays(2));
        Assert.NotEqual(stamp, suspended.SecurityStamp);
        Assert.True(await db.Audit.AnyAsync(a => a.Action == "user.suspend" && a.TargetId == Common && a.ActorId == Root));
        // Conta suspensa não vira admin.
        Assert.Equal(409, await Status(() => admin.SetRoleAsync(Common, new(PlatformRoles.Admin, "promoção"), Root, default)));

        db.ChangeTracker.Clear();
        await admin.UnsuspendAsync(Common, "Recurso aceito", Root, default);
        Assert.Null((await Fresh(Common)).LockoutEnd);
        Assert.Equal(409, await Status(() => admin.UnsuspendAsync(Common, null, Root, default)));
        Assert.True(await db.Audit.AnyAsync(a => a.Action == "user.unsuspend" && a.TargetId == Common));
    }

    [Fact]
    public async Task Admin_campaign_delete_requires_reason_refuses_live_session_and_is_audited()
    {
        var id = await campaigns.CreateAsync(new("Valdaran", "", RpgSystemId: RpgSystem.FreeSystemId), Common, default);
        db.Members.Add(new Member { CampaignId = id, UserId = Ambassador });
        db.Sessions.Add(new GameSession { CampaignId = id, Number = 1, Title = "Ao vivo" });
        await db.SaveChangesAsync(); db.ChangeTracker.Clear();
        Assert.Equal(400, await Status(() => campaigns.AdminDeleteAsync(id, Root, "", default)));
        Assert.Equal(409, await Status(() => campaigns.AdminDeleteAsync(id, Root, "Conteúdo abusivo", default)));
        await db.Sessions.Where(s => s.CampaignId == id).ExecuteUpdateAsync(s => s.SetProperty(x => x.EndedAt, DateTime.UtcNow));
        db.ChangeTracker.Clear();
        // Com jogadores vinculados a exclusão comum falha, a administrativa não.
        Assert.Equal(409, await Status(() => campaigns.DeleteAsync(id, Common, default)));
        db.ChangeTracker.Clear();
        await campaigns.AdminDeleteAsync(id, Root, "Conteúdo abusivo", default);
        Assert.False(await db.Campaigns.AnyAsync(c => c.Id == id));
        Assert.False(await db.Members.AnyAsync(m => m.CampaignId == id));
        var entry = await db.Audit.AsNoTracking().SingleAsync(a => a.Action == "campaign.delete");
        Assert.Equal(id.ToString(), entry.TargetId);
        Assert.Contains("abusivo", entry.Data);
        Assert.Contains("Conteúdo abusivo", entry.Summary);
    }

    [Fact]
    public async Task Audit_list_filters_and_resolves_actor_names()
    {
        await systems.CreateAsync(new("Tormenta20", null, ""), Root, default);
        audit.Record(AdminService.SystemActor, "user.role", "user", Common, "bootstrap"); await db.SaveChangesAsync();
        // O painel completo usa comparações de DateTimeOffset (suspensos) e é coberto em PostgreSQL por tests/admin.mjs.
        var recent = Prop<List<AuditView>>(await admin.AuditAsync(null, null, null, null, null, null, 1, default), "items");
        Assert.Equal(["Sistema", Root], recent.Select(a => a.ActorName));
        var page = await admin.AuditAsync("system.", Root, null, null, null, null, 1, default);
        Assert.Equal(1, Prop<int>(page, "total"));
        var byName = await admin.AuditAsync(null, "RO", null, null, null, null, 1, default);
        Assert.Equal(1, Prop<int>(byName, "total"));
        var detail = await admin.UserAsync(Common, Root, default);
        Assert.Single(Prop<List<AuditView>>(detail, "audit"));
        Assert.False(Prop<bool>(detail, "isSelf"));
    }

    [Fact]
    public async Task Bootstrap_promotes_only_confirmed_listed_emails_once()
    {
        var services = new ServiceCollection();
        services.AddDbContext<GameDb>(o => o.UseSqlite(connection));
        services.AddSingleton<IConfiguration>(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Platform:BootstrapAdmins:0"] = "Common@Example.test",
            ["Platform:BootstrapAdmins:1"] = "pending@example.test; root@example.test",
        }).Build());
        services.AddSingleton<ILookupNormalizer, UpperInvariantLookupNormalizer>();
        await using var provider = services.BuildServiceProvider();
        Assert.Equal(1, await AdminService.EnsureBootstrapAdminsAsync(provider, default));
        Assert.Equal(0, await AdminService.EnsureBootstrapAdminsAsync(provider, default));
        db.ChangeTracker.Clear();
        Assert.Equal(PlatformRoles.Admin, (await Fresh(Common)).Role);
        Assert.Equal(PlatformRoles.Common, (await Fresh(Pending)).Role);
        var entry = await db.Audit.AsNoTracking().SingleAsync(a => a.TargetId == Common);
        Assert.Equal("system", entry.ActorId);
    }
}
