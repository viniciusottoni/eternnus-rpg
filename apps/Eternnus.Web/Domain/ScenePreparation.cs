namespace Eternnus.Web;

/// <summary>Alcance da preparação do mapa de uma cena.</summary>
public static class SceneLayerModes
{
    /// <summary>Compartilhada: usa a camada do mapa, a mesma de outras cenas com este mapa e da aba Mapas e cenários (comportamento anterior).</summary>
    public const string Map = "map";
    /// <summary>Própria: paredes, luzes, marcas e exploração só desta cena. A imagem continua a mesma, sem duplicar bytes.</summary>
    public const string Scene = "scene";
    public static bool IsValid(string? v) => v is Map or Scene;
}

/// <summary>Apresentação das ferramentas do mestre. Preferência visual: não altera regras, visibilidade nem a mesa dos jogadores.</summary>
public static class InterfaceModes
{
    public const string Basic = "basic", Complete = "complete";
    public static bool IsValid(string? v) => v is Basic or Complete;
}

public record PreferencesInput(string? InterfaceMode);

/// <summary>Marcador enviado pelo editor de preparação (posições privadas, sem apresentar a cena).</summary>
public record SceneTokenInput(Guid? CharacterId, Guid? MasterCharacterId, string? Label, string? Side, int X, int Y, bool Hidden = false, int? Light = null, int? Fx = null, int? Fy = null,
    string? Appearance = null, int? Size = null, string? ImageUrl = null);

/// <summary>
/// Regras puras da preparação de cenas: chave da camada, separação entre preparação e estado ao vivo, aplicação explícita e reinício.
/// <list type="bullet">
/// <item>Recurso original: imagem e grade do mapa (nunca copiados).</item>
/// <item>Preparação: paredes, portas (estado inicial), luzes, marcas ocultas, névoa e casas reveladas de início; arranjo de marcadores na cena.</item>
/// <item>Estado ao vivo: explorações, revelações feitas na partida, portas abertas/fechadas na partida, percepções de marcas e marcadores da sessão.</item>
/// </list>
/// </summary>
public static class ScenePrep
{
    public const int MaxTokens = 60;
    static readonly string[] Sides = ["ally", "enemy", "neutral"];

    /// <summary>Chave da camada usada pela cena: a do mapa (compartilhada) ou {mapa}@{cena} (própria).</summary>
    public static string LayerKey(Scene s) => s.LayerMode == SceneLayerModes.Scene && s.MapKey.Length > 0 ? LayerKey(s.MapKey, s.Id) : s.MapKey;
    public static string LayerKey(string mapKey, Guid sceneId) => $"{mapKey}@{sceneId:N}";
    /// <summary>Camada efetiva da sessão; ignora uma chave que não pertença ao mapa atual.</summary>
    public static string SessionLayer(GameSession s) => s.LayerKey is { } k && k.StartsWith(s.MapKey + "@", StringComparison.Ordinal) ? k : s.MapKey;

    /// <summary>Somente a preparação de uma camada: sem explorações nem percepções de marcas.</summary>
    public static MapFogState PrepOf(MapFogState s) => new()
    {
        Fog = s.Fog, Manual = s.Manual, Cells = [.. s.Cells], Revealed = s.Revealed,
        Lights = s.Lights.Select(l => new FogLight { Id = l.Id, X = l.X, Y = l.Y, Radius = l.Radius }).ToList(),
        Marks = s.Marks.Select(CloneMark).ToList(),
    };

    static FogMark CloneMark(FogMark m) => new() { Id = m.Id, X = m.X, Y = m.Y, Kind = m.Kind, Label = m.Label, Dc = m.Dc, Sense = m.Sense, MaxDistance = m.MaxDistance };

    static bool IsDoor(char c) => c is TableFog.DoorClosed or TableFog.DoorOpen;

    /// <summary>
    /// "Aplicar à cena atual": troca paredes, luzes, marcas e névoa pela preparação, preservando o estado da partida —
    /// explorações, portas abertas ou fechadas onde continua havendo porta e quem já percebeu cada marca.
    /// Casas reveladas na preparação somam-se às já reveladas; aplicar nunca cobre o que o grupo já viu.
    /// </summary>
    public static void ApplyStructure(MapFogState live, MapFogState prep)
    {
        var cells = new string[prep.Cells.Length];
        for (var y = 0; y < prep.Cells.Length; y++)
        {
            var row = prep.Cells[y].ToCharArray();
            for (var x = 0; x < row.Length; x++)
                if (IsDoor(row[x]) && y < live.Cells.Length && x < live.Cells[y].Length && IsDoor(live.Cells[y][x])) row[x] = live.Cells[y][x];
            cells[y] = new string(row);
        }
        var marks = prep.Marks.Select(m =>
        {
            var copy = CloneMark(m);
            if (live.Marks.FirstOrDefault(o => o.Id == m.Id) is { } old) { copy.RevealedAll = old.RevealedAll; copy.RevealedTo = [.. old.RevealedTo]; }
            return copy;
        }).ToList();
        var size = cells.Length == 0 ? 0 : cells.Length * cells[0].Length;
        live.Cells = cells;
        live.Lights = prep.Lights.Select(l => new FogLight { Id = l.Id, X = l.X, Y = l.Y, Radius = l.Radius }).ToList();
        live.Marks = marks;
        live.Fog = prep.Fog; live.Manual = prep.Manual;
        live.Revealed = Bits.Encode(Bits.Or(Bits.Decode(live.Revealed, size), Bits.Decode(prep.Revealed, size)));
    }

    /// <summary>"Reiniciar cena": volta exatamente à preparação e recomeça a exploração (revelações, explorações e percepções).</summary>
    public static void Restart(MapFogState live, MapFogState prep)
    {
        var p = PrepOf(prep);
        live.Cells = p.Cells; live.Lights = p.Lights; live.Marks = p.Marks; live.Fog = p.Fog; live.Manual = p.Manual;
        live.Revealed = p.Revealed; live.Explored = [];
    }

    /// <summary>Mesma preparação? Portas abertas ou fechadas contam como iguais (é estado da partida).</summary>
    public static bool SameStructure(MapFogState a, MapFogState b)
    {
        static string Doors(string row) => new(row.Select(c => c == TableFog.DoorOpen ? TableFog.DoorClosed : c).ToArray());
        if (a.Fog != b.Fog || a.Manual != b.Manual || a.Cells.Length != b.Cells.Length) return false;
        if (a.Cells.Where((r, i) => Doors(r) != Doors(b.Cells[i])).Any()) return false;
        static string Light(FogLight l) => $"{l.X},{l.Y},{l.Radius}";
        static string Mark(FogMark m) => $"{m.Id}|{m.X},{m.Y}|{m.Kind}|{m.Label}|{m.Dc}|{m.Sense}|{m.MaxDistance}";
        return a.Lights.Select(Light).Order().SequenceEqual(b.Lights.Select(Light).Order())
            && a.Marks.Select(Mark).Order().SequenceEqual(b.Marks.Select(Mark).Order());
    }

    /// <summary>Visão simplificada aplicada à camada (nula = segue a configuração da mesa, sem alterar).</summary>
    public static void ApplyVision(MapFogState state, string? mode)
    {
        switch (mode)
        {
            case VisionModes.All: state.Fog = false; state.Manual = null; break;
            case VisionModes.Manual: state.Fog = true; state.Manual = true; break;
            case VisionModes.Character: state.Fog = true; state.Manual = false; break;
        }
    }

    /// <summary>A camada ao vivo já reflete a visão escolhida na cena?</summary>
    public static bool VisionApplied(MapFogState state, string? mode) => mode switch
    {
        VisionModes.All => state.Fog == false,
        VisionModes.Manual => state.Fog == true && state.Manual == true,
        VisionModes.Character => state.Fog == true && state.Manual == false,
        _ => true,
    };

    /// <summary>
    /// Valida o arranjo preparado: até 60 marcadores, dentro da grade, fora de casas que bloqueiam movimento e sem dois na mesma casa
    /// (em mapas de movimentação livre, <paramref name="free"/>, a casa pode ser dividida e a posição fina é guardada).
    /// Personagens precisam estar vinculados à campanha; personagens do mestre, pertencer a ela.
    /// </summary>
    public static List<SceneToken> ValidateTokens(IReadOnlyList<SceneTokenInput>? input, FogGrid grid, IReadOnlySet<Guid> characters, IReadOnlyDictionary<Guid, string> characterNames, IReadOnlySet<Guid> npcs, bool free = false)
    {
        var list = input ?? [];
        if (list.Count > MaxTokens) throw new RuleException(400, $"Use até {MaxTokens} marcadores por cena.");
        var taken = new HashSet<(int, int)>();
        var people = new HashSet<Guid>();
        var result = new List<SceneToken>();
        foreach (var t in list)
        {
            if (!grid.Inside(t.X, t.Y)) throw new RuleException(400, "Há um marcador fora do mapa. Mova-o para dentro da grade.");
            if (grid.BlocksMove(t.X, t.Y)) throw new RuleException(400, $"A casa {t.X + 1}, {t.Y + 1} bloqueia movimento. Escolha outra casa.");
            if (!taken.Add((t.X, t.Y)) && !free) throw new RuleException(400, $"Há dois marcadores na casa {t.X + 1}, {t.Y + 1}.");
            var (fx, fy) = FinePositions.Clean(free, t.Fx, t.Fy);
            if (t.Light is < 0 or > TableFog.MaxRadius) throw new RuleException(400, $"A luz vai de 0 a {TableFog.MaxRadius} casas.");
            // Aparência: ausente = redondo, 100%. O asset da imagem é conferido pelo serviço (pertence à campanha).
            var appearance = t.Appearance == null ? null : TokenLooks.Require(t.Appearance);
            var size = t.Size is { } sz ? TokenLooks.RequireSize(sz) : (int?)null;
            var image = NpcImages.Normalize(t.ImageUrl, out _);
            if (t.CharacterId is { } cid)
            {
                if (!characters.Contains(cid)) throw new RuleException(400, "Escolha personagens vinculados à campanha.");
                if (!people.Add(cid)) throw new RuleException(400, "Cada personagem aparece uma vez na cena.");
                var name = characterNames.GetValueOrDefault(cid) ?? "Personagem";
                result.Add(new SceneToken { CharacterId = cid, Label = name.Length > 40 ? name[..40] : name, Side = "ally", X = t.X, Y = t.Y, Fx = fx, Fy = fy, Appearance = appearance, Size = size, ImageUrl = image });
                continue;
            }
            var label = LibraryService.Clean(t.Label ?? "", false).Trim();
            if (label.Length is 0 or > TableFog.MaxLabel) throw new RuleException(400, $"Dê um nome de até {TableFog.MaxLabel} caracteres a cada marcador.");
            var side = t.Side ?? "enemy";
            if (!Sides.Contains(side)) throw new RuleException(400, "Escolha aliado, inimigo ou neutro.");
            if (t.MasterCharacterId is { } npc && !npcs.Contains(npc)) throw new RuleException(400, "Personagem do mestre não encontrado.");
            result.Add(new SceneToken { MasterCharacterId = t.MasterCharacterId, Label = label, Side = side, X = t.X, Y = t.Y, Fx = fx, Fy = fy, Hidden = t.Hidden, Light = t.Light, Appearance = appearance, Size = size, ImageUrl = image });
        }
        return result;
    }
}
