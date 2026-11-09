using ImageMagick;
using ImageMagick.Drawing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using System.Runtime.CompilerServices;
using System.Security.Cryptography;
namespace Eternnus.Web;

/// <summary>Mapa com grade + camada de névoa + marcadores resolvidos, pronto para calcular visibilidade.</summary>
public sealed class FogScene
{
    public required BattleMap Map { get; init; }
    public required FogGrid Grid { get; set; }
    public required MapFogState State { get; set; }
    public CampaignMapLayer? Row { get; init; }
    public required TableSettings Settings { get; init; }
    public required List<FogToken> Tokens { get; init; }
    public required Dictionary<Guid, SessionToken> Raw { get; init; }
    /// <summary>Chave da camada gravada: a do mapa ou a própria da cena apresentada.</summary>
    public string LayerKey { get; init; } = "";
    public bool Active => State.Fog ?? Settings.FogEnabled;
    /// <summary>Revelação manual: só as casas reveladas pelo mestre contam (luzes e visão não revelam).</summary>
    public bool Manual => State.Manual ?? Settings.ManualReveal;
    bool[]? shared;
    public bool[] Shared => shared ??= Manual ? Bits.Decode(State.Revealed, Grid.Width * Grid.Height) : FogRules.Shared(Grid, State, Tokens);
    public void Invalidate() { shared = null; Grid = new FogGrid(Map.Width, Map.Height, State.Cells); }
    public FogView View(string user) => FogRules.View(Grid, State, Tokens, Shared, user, Settings);
}

/// <summary>
/// Composição de configurações (sistema → campanha), camadas de névoa por mapa e projeção do que cada usuário recebe.
/// O servidor decide a visibilidade; o cliente apenas desenha.
/// </summary>
public sealed class TableFogService(GameDb db)
{
    static readonly MemoryCache MaskCache = new(new MemoryCacheOptions { SizeLimit = 96L * 1024 * 1024 });
    static readonly SemaphoreSlim Masking = new(2);
    IQueryable<CampaignMapLayer> Layers => db.Set<CampaignMapLayer>();

    // ---------- Configurações ----------
    public async Task<TableSettings> SystemSettingsAsync(Guid systemId, CancellationToken ct) =>
        TableSettings.Parse(await db.RpgSystems.AsNoTracking().Where(s => s.Id == systemId).Select(s => s.TableSettings).SingleOrDefaultAsync(ct));

    /// <summary>Configuração da campanha: ajustes do mestre ou, sem eles, o padrão do sistema.</summary>
    public async Task<TableSettings> CampaignSettingsAsync(Campaign c, CancellationToken ct) =>
        c.TableSettings != null ? TableSettings.Parse(c.TableSettings) : await SystemSettingsAsync(c.RpgSystemId, ct);

    /// <summary>Configuração efetiva: ajuste só desta sessão → campanha → sistema.</summary>
    public async Task<TableSettings> SettingsAsync(Campaign c, GameSession? s, CancellationToken ct) =>
        s?.TableSettings != null ? TableSettings.Parse(s.TableSettings) : await CampaignSettingsAsync(c, ct);

    // ---------- Mapas ----------
    public async Task<BattleMap?> MapAsync(Guid campaign, string key, CancellationToken ct)
    {
        var official = BattleMaps.Find(key);
        if (official != null) return official.Kind == MapKinds.Tileset ? official : null;
        return (await new CampaignAssetsService(db).ResolveMapAsync(campaign, key, ct))?.Battle();
    }

    /// <summary>
    /// Camada do mapa (<paramref name="layerKey"/> nulo) ou própria de uma cena. Uma camada própria ainda não gravada começa
    /// com a preparação da camada compartilhada do mesmo mapa (sem explorações), sem alterá-la.
    /// </summary>
    public async Task<(CampaignMapLayer? Row, MapFogState State)> LayerAsync(Guid campaign, BattleMap map, TableSettings settings, bool track, CancellationToken ct, string? layerKey = null)
    {
        var key = layerKey ?? map.Key;
        var query = track ? Layers : Layers.AsNoTracking();
        var row = await query.SingleOrDefaultAsync(l => l.CampaignId == campaign && l.MapKey == key, ct)
            ?? (track ? db.Set<CampaignMapLayer>().Local.FirstOrDefault(l => l.CampaignId == campaign && l.MapKey == key) : null);
        var state = MapFogState.Parse(row?.State);
        if (state == null && key != map.Key)
        {
            var shared = await Layers.AsNoTracking().Where(l => l.CampaignId == campaign && l.MapKey == map.Key).Select(l => new { l.State, l.Prepared }).SingleOrDefaultAsync(ct);
            var source = MapFogState.Parse(shared?.Prepared) ?? MapFogState.Parse(shared?.State);
            if (source != null) state = ScenePrep.PrepOf(TableFog.Fit(source, map, settings));
        }
        return (row, state == null ? TableFog.Initial(map, settings) : TableFog.Fit(state, map, settings));
    }

    /// <summary>Preparação da camada: a pendente (salva com a camada na mesa) ou a estrutura atual.</summary>
    public static MapFogState PreparedOf(CampaignMapLayer? row, MapFogState state, BattleMap map, TableSettings settings) =>
        MapFogState.Parse(row?.Prepared) is { } pending ? ScenePrep.PrepOf(TableFog.Fit(pending, map, settings)) : ScenePrep.PrepOf(state);

    /// <summary>Versão curta da preparação (não muda com explorações ao vivo): detecta edições concorrentes do preparo.</summary>
    public static string PrepVersion(MapFogState prep) => Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(ScenePrep.PrepOf(prep).Serialize())))[..16];

    /// <summary>Grava a camada (cria na primeira escrita). Chamar dentro da transação com a sessão/campanha bloqueada.</summary>
    public void Save(Guid campaign, FogScene scene) => SaveState(campaign, scene.LayerKey.Length > 0 ? scene.LayerKey : scene.Map.Key, scene.Row, scene.State);

    public CampaignMapLayer SaveState(Guid campaign, string key, CampaignMapLayer? row, MapFogState state)
    {
        var json = state.Serialize();
        if (json.Length > 400000) throw new RuleException(409, "A camada do mapa ficou grande demais. Recomece a exploração ou remova marcas.");
        if (row == null)
        {
            row = db.Set<CampaignMapLayer>().Local.FirstOrDefault(l => l.CampaignId == campaign && l.MapKey == key);
            if (row == null) { row = new CampaignMapLayer { CampaignId = campaign, MapKey = key }; db.Add(row); }
            else row.Revision++;
        }
        else row.Revision++;
        row.State = json; row.UpdatedAt = DateTime.UtcNow;
        return row;
    }

    /// <summary>Cena da sessão: nulo quando o mapa atual não tem grade.</summary>
    public async Task<FogScene?> SceneAsync(GameSession s, Campaign c, bool track, CancellationToken ct)
    {
        if (s.MapKind != MapKinds.Tileset) return null;
        var map = await MapAsync(s.CampaignId, s.MapKey, ct);
        if (map == null) return null;
        var settings = await SettingsAsync(c, s, ct);
        var layerKey = ScenePrep.SessionLayer(s);
        var (row, state) = await LayerAsync(s.CampaignId, map, settings, track, ct, layerKey);
        var tokens = await (track ? db.SessionTokens : db.SessionTokens.AsNoTracking()).Where(t => t.SessionId == s.Id).OrderBy(t => t.Label).ThenBy(t => t.Id).ToListAsync(ct);
        // Inclui marcadores ainda não gravados (mesma transação).
        if (track) tokens = tokens.Concat(db.SessionTokens.Local.Where(t => t.SessionId == s.Id && !tokens.Contains(t))).Where(t => db.Entry(t).State != EntityState.Deleted).ToList();
        var ids = tokens.Where(t => t.CharacterId != null).Select(t => t.CharacterId!.Value).ToList();
        var characters = await db.Characters.AsNoTracking().Where(ch => ids.Contains(ch.Id))
            .Select(ch => new { ch.Id, ch.LightMeters, ch.VisionMeters, ch.Perception, ch.Senses }).ToDictionaryAsync(ch => ch.Id, ct);
        var owners = await db.SessionParticipants.AsNoTracking().Where(p => p.SessionId == s.Id && p.CharacterId != null && !p.IsMaster)
            .Select(p => new { p.CharacterId, p.UserId }).ToListAsync(ct);
        var ownerOf = owners.GroupBy(o => o.CharacterId!.Value).ToDictionary(g => g.Key, g => g.First().UserId);
        var scale = map.ScaleMeters;
        var manual = state.Manual ?? settings.ManualReveal;
        var resolved = tokens.Select(t =>
        {
            var ch = t.CharacterId is { } cid ? characters.GetValueOrDefault(cid) : null;
            var light = t.Light ?? (t.CharacterId == null ? settings.CreatureLight : TableFog.MetersToCells(ch?.LightMeters ?? settings.PlayerLightMeters, scale));
            var vision = t.Vision ?? (t.CharacterId == null ? 0 : TableFog.MetersToCells(ch?.VisionMeters ?? settings.PlayerVisionMeters, scale));
            var senses = TableFog.ParseSenses(t.Senses ?? ch?.Senses).Select(x => (x.Name, x.Meters is { } m ? (int?)TableFog.MetersToCells(m, scale) : null)).ToList();
            return new FogToken(t.Id, t.CharacterId, t.CharacterId is { } c2 ? ownerOf.GetValueOrDefault(c2) : null, t.Side, t.X, t.Y,
                manual ? 0 : Math.Clamp(light, 0, TableFog.MaxRadius), manual ? 0 : Math.Clamp(vision, 0, TableFog.MaxRadius), t.Perception ?? ch?.Perception ?? 0, senses,
                t.CharacterId == null && t.Hidden, t.RevealedTo, t.Dc, t.DetectSense, t.DetectRange);
        }).ToList();
        return new FogScene
        {
            Map = map, Grid = new FogGrid(map.Width, map.Height, state.Cells), State = state, Row = row, Settings = settings,
            Tokens = resolved, Raw = tokens.ToDictionary(t => t.Id), LayerKey = layerKey,
        };
    }

    /// <summary>
    /// Depois de uma escrita que muda a visibilidade: soma o que cada jogador vê às explorações e aplica a detecção automática.
    /// Devolve as detecções para o chamador registrar eventos.
    /// </summary>
    public List<(string Target, string User, string Label)> Refresh(Guid campaign, FogScene scene)
    {
        var found = new List<(string, string, string)>();
        if (!scene.Active) return found;
        var changed = false;
        foreach (var (target, user, _) in FogRules.Detect(scene.Grid, scene.State, scene.Tokens, scene.Shared))
        {
            if (target.StartsWith("mark:"))
            {
                var mark = scene.State.Marks.First(m => "mark:" + m.Id == target);
                mark.RevealedTo.Add(user); changed = true; found.Add((target, user, mark.Label));
            }
            else if (Guid.TryParse(target, out var id) && scene.Raw.TryGetValue(id, out var raw))
            {
                raw.RevealedTo = [.. raw.RevealedTo, user]; found.Add((target, user, raw.Label));
            }
        }
        if (found.Count > 0)
        {
            // Revelações mudam marcadores visíveis, não a luz (ocultos não emitem luz).
            var refreshed = scene.Tokens.Select(t => scene.Raw.TryGetValue(t.Id, out var r) ? t with { RevealedTo = r.RevealedTo } : t).ToList();
            scene.Tokens.Clear(); scene.Tokens.AddRange(refreshed);
        }
        foreach (var user in scene.Tokens.Where(t => t.OwnerUserId != null).Select(t => t.OwnerUserId!).Distinct())
        {
            var view = scene.View(user);
            var before = scene.State.Explored.GetValueOrDefault(user) ?? "";
            var after = Bits.Encode(view.Explored);
            if (after != before) { scene.State.Explored[user] = after; changed = true; }
        }
        if (changed) Save(campaign, scene);
        return found;
    }

    // ---------- Projeção ----------
    /// <summary>Linhas com as casas desconhecidas trocadas por "?" (o jogador não recebe paredes nem terreno de onde nunca viu).</summary>
    public static string[] MaskRows(string[] rows, bool[] known, int width) =>
        rows.Select((row, y) => new string(row.Select((c, x) => known[y * width + x] ? c : TableFog.Unknown).ToArray())).ToArray();

    public static string ImageVersion(bool[] known) => Convert.ToHexString(SHA256.HashData(Convert.FromBase64String(Bits.Encode(known) is { Length: > 0 } b ? b : "AA==")))[..16];

    /// <summary>Tudo o que o mestre precisa para preparar e conduzir; inclui a união das explorações para avisar ao escurecer.</summary>
    public object MasterFog(FogScene scene, IEnumerable<object> players)
    {
        var explored = new bool[scene.Map.Width * scene.Map.Height];
        foreach (var e in scene.State.Explored.Values) explored = Bits.Or(explored, Bits.Decode(e, explored.Length));
        return new
        {
            active = scene.Active, inherited = scene.State.Fog == null, cells = scene.State.Cells, revealed = scene.State.Revealed, shared = Bits.Encode(scene.Shared),
            explored = Bits.Encode(explored), lights = scene.State.Lights, marks = scene.State.Marks, revision = scene.Row?.Revision ?? 0, settings = scene.Settings, players,
        };
    }

    // ---------- Imagem mascarada ----------
    /// <summary>
    /// Imagem do mapa enviado para um jogador: casas não exploradas (e faixas fora da grade) em preto.
    /// Nenhum pixel de casa desconhecida sai do servidor. Falha nunca devolve a imagem completa.
    /// </summary>
    public static async Task<byte[]> MaskAsync(Guid mapId, int mapRevision, byte[] content, int gridPixels, int width, int height, bool[] known, CancellationToken ct, int offsetX = 0, int offsetY = 0)
    {
        var key = $"{mapId}:{mapRevision}:{offsetX}:{offsetY}:{ImageVersion(known)}";
        if (MaskCache.TryGetValue(key, out byte[]? cached) && cached != null) return cached;
        if (!await Masking.WaitAsync(TimeSpan.FromSeconds(10), ct)) throw new RuleException(429, "O mapa está sendo preparado. Tente novamente em instantes.");
        try
        {
            RuntimeHelpers.RunClassConstructor(typeof(AvatarProcessor).TypeHandle);
            using var image = new MagickImage(content, new MagickReadSettings { Format = MagickFormat.Jpeg });
            var drawables = new Drawables().FillColor(MagickColors.Black).StrokeColor(MagickColors.Transparent);
            var any = false;
            // Fora da grade: faixas antes do deslocamento (esquerda/topo) e parciais depois da última casa (direita/abaixo).
            if (offsetX > 0) { drawables.Rectangle(0, 0, offsetX - 1, image.Height); any = true; }
            if (offsetY > 0) { drawables.Rectangle(0, 0, image.Width, offsetY - 1); any = true; }
            if (image.Width > (uint)(offsetX + width * gridPixels)) { drawables.Rectangle(offsetX + width * gridPixels, 0, image.Width, image.Height); any = true; }
            if (image.Height > (uint)(offsetY + height * gridPixels)) { drawables.Rectangle(0, offsetY + height * gridPixels, image.Width, image.Height); any = true; }
            for (var y = 0; y < height; y++)
                for (var x = 0; x < width;)
                {
                    if (known[y * width + x]) { x++; continue; }
                    var start = x; while (x < width && !known[y * width + x]) x++;
                    drawables.Rectangle(offsetX + start * gridPixels, offsetY + y * gridPixels, offsetX + x * gridPixels - 1, offsetY + (y + 1) * gridPixels - 1); any = true;
                }
            if (any) drawables.Draw(image);
            image.Strip(); image.Quality = 85;
            var bytes = image.ToByteArray(MagickFormat.Jpeg);
            MaskCache.Set(key, bytes, new MemoryCacheEntryOptions { Size = bytes.Length, SlidingExpiration = TimeSpan.FromMinutes(20) });
            return bytes;
        }
        catch (MagickException) { throw new RuleException(503, "Não foi possível preparar o mapa agora. Tente novamente."); }
        finally { Masking.Release(); }
    }
}
