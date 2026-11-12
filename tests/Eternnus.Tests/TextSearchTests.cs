using Eternnus.Web;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Tests;

/// <summary>Busca sem diferenciar maiúsculas nem acentos ("gargula" encontra "Gárgula").</summary>
public sealed class TextSearchTests : IAsyncLifetime
{
    readonly SqliteConnection connection = new("Data Source=:memory:");
    GameDb db = null!;
    CampaignService campaigns = null!;
    public async Task InitializeAsync()
    {
        await connection.OpenAsync();
        db = new(new DbContextOptionsBuilder<GameDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        db.Users.Add(new AppUser { Id = "master", Role = PlatformRoles.Ambassador });
        await db.SaveChangesAsync();
        campaigns = new(db, new ProgressionService(db, new AuditService(db)), new AuditService(db));
    }
    public async Task DisposeAsync() { await db.DisposeAsync(); await connection.DisposeAsync(); }

    [Theory]
    [InlineData("Gárgula", "gargula")]
    [InlineData("FEITIÇO Ácido", "feitico acido")]
    [InlineData("Ñandú über", "nandu uber")]
    [InlineData("", "")]
    public void Fold_lowercases_and_removes_accents(string input, string expected) => Assert.Equal(expected, TextSearch.Fold(input));

    [Fact]
    public void Pattern_folds_term_and_keeps_wildcards_escaped() => Assert.Equal("%gar\\%gula\\_%", TextSearch.Pattern("GÁR%gula_"));

    [Fact]
    public void Excerpt_finds_term_ignoring_accents_and_keeps_original_text()
    {
        Assert.Equal("A Gárgula vigia", TextSearch.Excerpt("A Gárgula vigia", "gargula"));
        Assert.Equal("…Gárgula…", TextSearch.Excerpt("A Gárgula vigia", "GARGULA", 0));
        Assert.Null(TextSearch.Excerpt("A Gárgula vigia", "dragão"));
    }

    [Theory]
    [InlineData("gargula")]
    [InlineData("GARGULA")]
    [InlineData("gárgula")]
    [InlineData("Gargula")]
    public async Task Database_search_ignores_case_and_accents(string term)
    {
        await campaigns.CreateAsync(new("Ninho da Gárgula", "", RpgSystemId: RpgSystem.FreeSystemId), "master", default);
        await campaigns.CreateAsync(new("Torre do Dragão", "", RpgSystemId: RpgSystem.FreeSystemId), "master", default);
        var found = await db.Campaigns.Where(TextSearch.AnyField<Campaign>(db, TextSearch.Pattern(term), c => c.Name)).Select(c => c.Name).ToListAsync();
        Assert.Equal(["Ninho da Gárgula"], found);
    }

    [Fact]
    public void Postgres_compares_unaccented_column_with_ilike()
    {
        using var pg = new GameDb(new DbContextOptionsBuilder<GameDb>().UseNpgsql("Host=localhost;Database=unused").Options);
        var sql = pg.Campaigns.Where(TextSearch.AnyField<Campaign>(pg, TextSearch.Pattern("Gárgula"), c => c.Name)).ToQueryString();
        Assert.Contains("unaccent(c.\"Name\") ILIKE unaccent(", sql);
        Assert.DoesNotContain("Gárgula", sql);
    }
}
