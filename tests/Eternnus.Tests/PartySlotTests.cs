using System.Text.Json;
using Eternnus.Web;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Eternnus.Tests;

/// <summary>
/// Personagens reservados (ADR-110): lista, edição, cópia, exclusão, limite, revisão, acesso só do mestre, arranjo de cenas com
/// reservados, vínculo a um personagem real (preservando posição e aparência), conflitos, desvínculo e separação da mesa ao vivo (SQLite).
/// </summary>
public sealed class PartySlotTests : IAsyncLifetime
{
    readonly SqliteConnection connection = new("Data Source=:memory:");
    GameDb db = null!;
    PartySlotService slots = null!;
    PreparationService prep = null!;
    Campaign campaign = null!;
    Character hero = null!, other = null!;
    const string Master = "master", Player = "player", Outsider = "outsider";
    static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);
    static readonly BattleMap Crypt = BattleMaps.Find("crypt")!;

    public async Task InitializeAsync()
    {
        await connection.OpenAsync();
        db = new GameDb(new DbContextOptionsBuilder<GameDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        foreach (var id in new[] { Master, Player, Outsider }) db.Users.Add(new AppUser { Id = id, UserName = id, DisplayName = id });
        campaign = new Campaign { OwnerId = Master, Name = "Valdaran" };
        hero = new Character { OwnerId = Player, Name = "Tharion", Hp = 10, MaxHp = 10 };
        other = new Character { OwnerId = Player, Name = "Mira", Hp = 10, MaxHp = 10 };
        db.AddRange(campaign, hero, other, new Member { CampaignId = campaign.Id, UserId = Player },
            new CampaignCharacter { CampaignId = campaign.Id, CharacterId = hero.Id }, new CampaignCharacter { CampaignId = campaign.Id, CharacterId = other.Id });
        await db.SaveChangesAsync();
        slots = new PartySlotService(db, TimeProvider.System);
        prep = new PreparationService(db, TimeProvider.System);
    }
    public async Task DisposeAsync() { await db.DisposeAsync(); await connection.DisposeAsync(); }

    static async Task<int> Status(Func<Task> act) => (await Assert.ThrowsAsync<RuleException>(act)).Status;
    static JsonElement J(object o) => JsonSerializer.SerializeToElement(o, Web);

    /// <summary>Casas livres do mapa oficial, longe dos pontos de entrada.</summary>
    static List<(int X, int Y)> FreeCells()
    {
        var cells = TableFog.Initial(Crypt, TableSettings.Default).Cells;
        var spawns = Crypt.Spawns().ToHashSet();
        var list = new List<(int, int)>();
        for (var y = 0; y < Crypt.Height; y++) for (var x = 0; x < Crypt.Width; x++)
                if (cells[y][x] == TableFog.Free && Crypt.CanStand(x, y) && !spawns.Contains((x, y)) && spawns.All(s => Math.Abs(s.X - x) + Math.Abs(s.Y - y) > 3)) list.Add((x, y));
        return list;
    }

    async Task<PartySlotView> Create(string? name = null, string? image = null)
    {
        db.ChangeTracker.Clear();
        return await slots.CreateAsync(campaign.Id, new PartySlotInput(name, null, image, null, null, null, null), Master, default);
    }
    async Task<JsonElement> Fresh(Guid id) { db.ChangeTracker.Clear(); return J(await slots.ListAsync(campaign.Id, Master, default)).GetProperty("items").EnumerateArray().Single(s => s.GetProperty("id").GetGuid() == id); }
    async Task<Guid> SaveScene(List<SceneTokenInput> tokens, Guid? id = null, int revision = 0)
    {
        db.ChangeTracker.Clear();
        return J(await prep.SaveSceneAsync(campaign.Id, id, new SceneInput("Cripta", "", SceneKinds.Map, null, "crypt", "", "", null, 0, revision, tokens), Master, default)).GetProperty("id").GetGuid();
    }
    async Task<Scene> Scene(Guid id) { db.ChangeTracker.Clear(); return await db.Scenes.AsNoTracking().SingleAsync(s => s.Id == id); }

    [Fact]
    public async Task Create_list_rename_duplicate_and_delete_update_scene_tokens()
    {
        var a = await Create();
        Assert.Equal("Aventureiro 1", a.Name);
        var b = await Create("  Lyra  ");
        Assert.Equal("Lyra", b.Name);
        Assert.Equal("Aventureiro 2", (await Create("")).Name);
        Assert.Equal(400, await Status(() => Create(new string('x', 41))));

        var free = FreeCells();
        var scene = await SaveScene([new(null, null, null, null, free[0].X, free[0].Y, SlotId: a.Id), new(null, null, null, null, free[5].X, free[5].Y, SlotId: b.Id),
            new(null, null, "Lobo", "enemy", free[10].X, free[10].Y)]);
        var list = J(await slots.ListAsync(campaign.Id, Master, default));
        Assert.Equal(3, list.GetProperty("items").GetArrayLength());
        Assert.Equal(1, list.GetProperty("items")[0].GetProperty("scenes").GetInt32());
        Assert.Equal(2, list.GetProperty("characters").GetArrayLength());
        Assert.Equal(JsonValueKind.Null, list.GetProperty("characters")[0].GetProperty("slotId").ValueKind);

        // Renomear muda o nome dos marcadores sem personagem e a revisão da cena.
        var before = (await Scene(scene)).Revision;
        db.ChangeTracker.Clear();
        var renamed = await slots.UpdateAsync(campaign.Id, b.Id, new PartySlotInput("Lyra Vento", "mage", null, "round", 150, null, null, b.Revision), Master, default);
        Assert.Equal("Lyra Vento", renamed.Name);
        Assert.Equal("mage", renamed.Archetype);
        Assert.Equal(1, renamed.Scenes);
        var s = await Scene(scene);
        Assert.Equal("Lyra Vento", s.Prepared.Single(t => t.SlotId == b.Id).Label);
        Assert.Equal(before + 1, s.Revision);
        // Revisão antiga: 409.
        db.ChangeTracker.Clear();
        Assert.Equal(409, await Status(() => slots.UpdateAsync(campaign.Id, b.Id, new PartySlotInput("Outro", null, null, null, null, null, null, b.Revision), Master, default)));
        Assert.Equal(400, await Status(() => slots.UpdateAsync(campaign.Id, b.Id, new PartySlotInput("Ok", "dragon", null, null, null, null, null, renamed.Revision), Master, default)));

        db.ChangeTracker.Clear();
        var copy = await slots.DuplicateAsync(campaign.Id, b.Id, Master, default);
        Assert.Equal("Lyra Vento (cópia)", copy.Name);
        Assert.Equal("mage", copy.Archetype);
        Assert.Equal(150, copy.Size);
        Assert.Null(copy.CharacterId);
        Assert.Equal(0, (await Fresh(copy.Id)).GetProperty("scenes").GetInt32());

        // Excluir remove os marcadores sem personagem.
        db.ChangeTracker.Clear();
        await slots.DeleteAsync(campaign.Id, a.Id, Master, default);
        s = await Scene(scene);
        Assert.DoesNotContain(s.Prepared, t => t.SlotId == a.Id);
        Assert.Equal(2, s.Prepared.Count);
        Assert.Equal(404, await Status(() => slots.DeleteAsync(campaign.Id, a.Id, Master, default)));
    }

    [Fact]
    public async Task Limit_of_twelve_and_only_master_manages()
    {
        for (var i = 0; i < PartySlotService.MaxSlots; i++) await Create();
        Assert.Equal(409, await Status(() => Create()));
        var first = await db.PartySlots.AsNoTracking().OrderBy(s => s.Order).FirstAsync();
        db.ChangeTracker.Clear();
        Assert.Equal(409, await Status(() => slots.DuplicateAsync(campaign.Id, first.Id, Master, default)));

        db.ChangeTracker.Clear();
        Assert.Equal(403, await Status(() => slots.ListAsync(campaign.Id, Player, default)));
        Assert.Equal(404, await Status(() => slots.ListAsync(campaign.Id, Outsider, default)));
        db.ChangeTracker.Clear();
        Assert.Equal(403, await Status(() => slots.CreateAsync(campaign.Id, new PartySlotInput("X", null, null, null, null, null, null), Player, default)));
        db.ChangeTracker.Clear();
        Assert.Equal(404, await Status(() => slots.DeleteAsync(campaign.Id, first.Id, Outsider, default)));
        db.ChangeTracker.Clear();
        Assert.Equal(403, await Status(() => slots.BindPreviewAsync(campaign.Id, first.Id, new(hero.Id), Player, default)));
        db.ChangeTracker.Clear();
        Assert.Equal(PartySlotService.MaxSlots, await db.PartySlots.CountAsync());
    }

    [Fact]
    public async Task Scene_keeps_slot_tokens_once_and_refuses_rehearsal_and_unknown_slots()
    {
        var a = await Create("Ana"); var b = await Create("Bia"); var c = await Create("Caio");
        var free = FreeCells();
        // CharacterId enviado com um reservado sem vínculo é ignorado: o estado do reservado vence.
        var scene = await SaveScene([new(hero.Id, null, "x", "enemy", free[0].X, free[0].Y, Hidden: true, SlotId: a.Id), new(null, null, null, null, free[3].X, free[3].Y, SlotId: b.Id),
            new(null, null, null, null, free[6].X, free[6].Y, SlotId: c.Id)]);
        var view = J(await prep.SceneAsync(campaign.Id, scene, Master, default));
        var prepared = view.GetProperty("prepared");
        Assert.Equal(3, prepared.GetArrayLength());
        Assert.Equal(a.Id, prepared[0].GetProperty("slotId").GetGuid());
        Assert.Equal("Ana", prepared[0].GetProperty("label").GetString());
        Assert.Equal("ally", prepared[0].GetProperty("side").GetString());
        Assert.False(prepared[0].GetProperty("hidden").GetBoolean());
        Assert.Equal(JsonValueKind.Null, prepared[0].GetProperty("characterId").ValueKind);
        Assert.Equal(3, view.GetProperty("slots").GetArrayLength());
        Assert.All(view.GetProperty("slots").EnumerateArray(), s => Assert.Equal(1, s.GetProperty("scenes").GetInt32()));
        Assert.Equal(3, J(await prep.ScenesAsync(campaign.Id, Master, default)).GetProperty("slots").GetArrayLength());

        var rev = (await Scene(scene)).Revision;
        Assert.Equal(400, await Status(() => SaveScene([new(null, null, null, null, free[0].X, free[0].Y, SlotId: a.Id), new(null, null, null, null, free[3].X, free[3].Y, SlotId: a.Id)], scene, rev)));
        Assert.Equal(400, await Status(() => SaveScene([new(null, null, null, null, free[0].X, free[0].Y, SlotId: Guid.NewGuid())], scene, rev)));
        Assert.Equal(400, await Status(() => SaveScene([new(null, null, "Ensaio", "ally", free[0].X, free[0].Y, Rehearsal: true)], scene, rev)));
        // Cenas antigas, sem reservados, continuam válidas.
        Assert.NotEqual(Guid.Empty, await SaveScene([new(hero.Id, null, null, null, free[0].X, free[0].Y), new(null, null, "Lobo", "enemy", free[3].X, free[3].Y)], scene, rev));
    }

    [Fact]
    public async Task Bind_keeps_geometry_and_image_and_unbind_restores_the_reserved_token()
    {
        var slot = await Create("Reserva", "https://example.com/reserva.png");
        var free = FreeCells();
        var (x, y) = free.First(p => free.Contains((p.X + 1, p.Y)) && free.Contains((p.X, p.Y + 1)) && free.Contains((p.X + 1, p.Y + 1)));
        var scene = await SaveScene([new(null, null, null, null, x, y, Appearance: "image", Size: 120, ImageUrl: "https://example.com/token.png", Width: 200, Height: 200, SlotId: slot.Id)]);
        var original = (await Scene(scene)).Prepared.Single();
        var revision = (await Scene(scene)).Revision;

        db.ChangeTracker.Clear();
        var preview = J(await slots.BindPreviewAsync(campaign.Id, slot.Id, new(hero.Id), Master, default));
        Assert.Equal("Tharion", preview.GetProperty("characterName").GetString());
        Assert.Equal(1, preview.GetProperty("scenes").GetInt32());
        Assert.Equal(0, preview.GetProperty("conflicts").GetArrayLength());
        Assert.False(preview.GetProperty("activeSession").GetBoolean());
        Assert.Equal(revision, (await Scene(scene)).Revision); // prévia não grava

        db.ChangeTracker.Clear();
        Assert.Equal(400, await Status(() => slots.BindCharacterAsync(campaign.Id, slot.Id, new(Guid.NewGuid(), slot.Revision), Master, default)));
        db.ChangeTracker.Clear();
        Assert.Equal(400, await Status(() => slots.BindCharacterAsync(campaign.Id, slot.Id, new(hero.Id, slot.Revision, Resolve: "outro"), Master, default)));
        db.ChangeTracker.Clear();
        var bound = await slots.BindCharacterAsync(campaign.Id, slot.Id, new(hero.Id, slot.Revision), Master, default);
        Assert.Equal(hero.Id, bound.CharacterId);
        Assert.Equal("Tharion", bound.CharacterName);
        Assert.False(bound.ActiveSession);
        var t = (await Scene(scene)).Prepared.Single();
        Assert.Equal(hero.Id, t.CharacterId);
        Assert.Equal(slot.Id, t.SlotId);
        Assert.Equal("Tharion", t.Label);
        Assert.Equal((original.X, original.Y, original.Size, original.Width, original.Height, original.Layer, original.Appearance), (t.X, t.Y, t.Size, t.Width, t.Height, t.Layer, t.Appearance));
        Assert.Equal("https://example.com/token.png", t.ImageUrl);
        Assert.Equal(revision + 1, (await Scene(scene)).Revision);
        var chars = J(await slots.ListAsync(campaign.Id, Master, default)).GetProperty("characters").EnumerateArray().ToList();
        Assert.Equal(slot.Id, chars.Single(c => c.GetProperty("name").GetString() == "Tharion").GetProperty("slotId").GetGuid());

        // Salvar a cena com o marcador vinculado continua válido (o vínculo vira marcador do personagem).
        var r = (await Scene(scene)).Revision;
        await SaveScene([new(null, null, null, null, x, y, Appearance: "image", Width: 200, Height: 200, SlotId: slot.Id)], scene, r);
        Assert.Equal(hero.Id, (await Scene(scene)).Prepared.Single().CharacterId);

        // Outro reservado não pode receber o mesmo personagem.
        var second = await Create("Segundo");
        db.ChangeTracker.Clear();
        Assert.Equal(409, await Status(() => slots.BindCharacterAsync(campaign.Id, second.Id, new(hero.Id, second.Revision), Master, default)));

        db.ChangeTracker.Clear();
        var unbound = await slots.UnbindAsync(campaign.Id, slot.Id, new(bound.Revision), Master, default);
        Assert.Null(unbound.CharacterId);
        t = (await Scene(scene)).Prepared.Single();
        Assert.Null(t.CharacterId);
        Assert.Equal("Reserva", t.Label);
        Assert.Equal(slot.Id, t.SlotId);

        // Sem manter a imagem: o marcador passa a usar a do personagem.
        db.ChangeTracker.Clear();
        await SaveScene([new(null, null, null, null, x, y, ImageUrl: "https://example.com/token.png", SlotId: slot.Id)], scene, (await Scene(scene)).Revision);
        db.ChangeTracker.Clear();
        await slots.BindCharacterAsync(campaign.Id, slot.Id, new(hero.Id, unbound.Revision, KeepImage: false), Master, default);
        Assert.Null((await Scene(scene)).Prepared.Single().ImageUrl);
    }

    [Fact]
    public async Task Bind_conflicts_require_a_choice_and_never_duplicate_the_character()
    {
        var slot = await Create("Reserva");
        var free = FreeCells();
        var scene = await SaveScene([new(null, null, null, null, free[0].X, free[0].Y, SlotId: slot.Id), new(hero.Id, null, null, null, free[5].X, free[5].Y)]);

        db.ChangeTracker.Clear();
        var preview = J(await slots.BindPreviewAsync(campaign.Id, slot.Id, new(hero.Id), Master, default));
        Assert.Equal(scene, preview.GetProperty("conflicts")[0].GetProperty("sceneId").GetGuid());
        db.ChangeTracker.Clear();
        Assert.Equal(409, await Status(() => slots.BindCharacterAsync(campaign.Id, slot.Id, new(hero.Id, slot.Revision), Master, default)));
        Assert.Null((await db.PartySlots.AsNoTracking().SingleAsync()).CharacterId);

        // "slot": fica o marcador do reservado (posição dele), sai o do personagem.
        db.ChangeTracker.Clear();
        var bound = await slots.BindCharacterAsync(campaign.Id, slot.Id, new(hero.Id, slot.Revision, Resolve: "slot"), Master, default);
        var t = Assert.Single((await Scene(scene)).Prepared);
        Assert.Equal((hero.Id, slot.Id, free[0].X, free[0].Y), (t.CharacterId!.Value, t.SlotId!.Value, t.X, t.Y));

        // "character": fica o marcador do personagem (posição dele), com o vínculo ao reservado.
        db.ChangeTracker.Clear();
        var unbound = await slots.UnbindAsync(campaign.Id, slot.Id, new(bound.Revision), Master, default);
        await SaveScene([new(null, null, null, null, free[0].X, free[0].Y, SlotId: slot.Id), new(hero.Id, null, null, null, free[5].X, free[5].Y)], scene, (await Scene(scene)).Revision);
        db.ChangeTracker.Clear();
        await slots.BindCharacterAsync(campaign.Id, slot.Id, new(hero.Id, unbound.Revision, Resolve: "character"), Master, default);
        t = Assert.Single((await Scene(scene)).Prepared);
        Assert.Equal((hero.Id, slot.Id, free[5].X, free[5].Y), (t.CharacterId!.Value, t.SlotId!.Value, t.X, t.Y));
    }

    [Fact]
    public void Unbound_reserved_tokens_never_enter_the_live_table()
    {
        var free = FreeCells();
        var grid = FogGrid.Of(Crypt, TableFog.Initial(Crypt, TableSettings.Default));
        var slotId = Guid.NewGuid();
        List<SceneToken> source =
        [
            new() { SlotId = Guid.NewGuid(), Label = "Reserva", Side = "ally", X = free[0].X, Y = free[0].Y },
            new() { Label = "Lobo", Side = "enemy", X = free[3].X, Y = free[3].Y },
            new() { CharacterId = hero.Id, SlotId = slotId, Label = "Tharion", Side = "ally", X = free[6].X, Y = free[6].Y },
        ];
        var plan = ScenePlacement.Plan(Crypt, grid, source, [hero.Id], []);
        Assert.Equal(2, plan.Count);
        Assert.Contains(plan, p => p.CharacterId == hero.Id && p.X == free[6].X && p.Y == free[6].Y);
        Assert.Contains(plan, p => p.Source?.Label == "Lobo");
        Assert.DoesNotContain(plan, p => p.Source?.Label == "Reserva");

        // Guardar o arranjo da mesa: o reservado sem personagem volta (se cabe) e o personagem recupera o vínculo.
        List<SceneToken> captured = [new() { CharacterId = hero.Id, Label = "Tharion", Side = "ally", X = free[8].X, Y = free[8].Y }];
        var kept = ScenePlacement.KeepSlots(Crypt, grid, captured, source);
        Assert.Equal(2, kept.Count);
        Assert.Equal(slotId, kept[0].SlotId);
        Assert.Equal("Reserva", kept[1].Label);
        // No mesmo lugar de outro marcador, o reservado não volta; em outro mapa, só o vínculo é recuperado.
        Assert.Single(ScenePlacement.KeepSlots(Crypt, grid, [new() { Label = "Lobo", X = free[0].X, Y = free[0].Y }], source));
        Assert.Single(ScenePlacement.KeepSlots(null, null, [new() { CharacterId = hero.Id, X = 1, Y = 1 }], source));
    }
}
