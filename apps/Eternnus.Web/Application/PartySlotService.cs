using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

/// <summary>Criar ou editar um personagem reservado. Nome vazio = "Aventureiro N". <c>Revision</c> só conta na edição.</summary>
public record PartySlotInput(string? Name, string? Archetype, string? ImageUrl, string? Appearance, int? Size, int? Width, int? Height, int Revision = 0);
/// <summary>Prévia do vínculo (somente leitura).</summary>
public record PartyBindPreviewInput(Guid CharacterId);
/// <summary>Vínculo a um personagem real. <c>Resolve</c>: nulo, "slot" (fica o marcador do reservado) ou "character" (fica o marcador do personagem).</summary>
public record PartyBindInput(Guid CharacterId, int Revision, bool KeepImage = true, string? Resolve = null);
public record PartyUnbindInput(int Revision);

/// <summary>Reservado como a lista e o editor o mostram. <c>Scenes</c>: cenas em que ele tem marcador. <c>ActiveSession</c> só na resposta do vínculo.</summary>
public sealed record PartySlotView(Guid Id, string Name, string? Archetype, string? ImageUrl, string? Appearance, int? Size, int? Width, int? Height,
    Guid? CharacterId, string? CharacterName, int Order, int Revision, int Scenes,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] bool? ActiveSession = null);

/// <summary>
/// Personagens reservados (ADR-110): criar, editar, duplicar, excluir, vincular e desvincular. Só o mestre.
/// Mudanças nos marcadores valem para a preparação das cenas (arranjo preparado e salvo); a mesa ao vivo nunca é alterada aqui.
/// </summary>
public sealed class PartySlotService(GameDb db, TimeProvider clock)
{
    public const int MaxSlots = 12;
    const string Changed = "O personagem reservado mudou em outra tela. Recarregue.";
    const string Taken = "Esse personagem já está vinculado a outro personagem reservado.";
    DateTime Now => clock.GetUtcNow().UtcDateTime;
    PreparationService Prep => new(db, clock);

    sealed record Row(PartySlot Slot, string? CharacterName);

    static PartySlotView View(PartySlot s, string? characterName, int scenes, bool? active = null) =>
        new(s.Id, s.Name, s.Archetype, s.ImageUrl, s.Appearance, s.Size, s.Width, s.Height, s.CharacterId, characterName, s.Order, s.Revision, scenes, active);

    /// <summary>Reservados da campanha com o nome do personagem vinculado (uma consulta), por ordem e nome.</summary>
    static Task<List<Row>> RowsAsync(GameDb db, Guid campaignId, CancellationToken ct) =>
        (from s in db.PartySlots.AsNoTracking().Where(s => s.CampaignId == campaignId)
         join c in db.Characters.AsNoTracking() on s.CharacterId equals (Guid?)c.Id into g
         from c in g.DefaultIfEmpty()
         orderby s.Order, s.Name
         select new Row(s, c == null ? null : c.Name)).Take(MaxSlots).ToListAsync(ct);

    /// <summary>Marcadores de cada cena da campanha (preparado e salvo), projeção sem a composição visual.</summary>
    static async Task<List<IEnumerable<SceneToken>>> SceneTokensAsync(GameDb db, Guid campaignId, CancellationToken ct) =>
        (await db.Scenes.AsNoTracking().Where(s => s.CampaignId == campaignId).Take(PreparationService.MaxScenes).Select(s => new { s.Prepared, s.Saved }).ToListAsync(ct))
            .Select(s => s.Prepared.Concat(s.Saved)).ToList();

    static Dictionary<Guid, int> Counts(IEnumerable<IEnumerable<SceneToken>> scenes)
    {
        var counts = new Dictionary<Guid, int>();
        foreach (var tokens in scenes)
            foreach (var id in tokens.Where(t => t.SlotId != null).Select(t => t.SlotId!.Value).Distinct()) counts[id] = counts.GetValueOrDefault(id) + 1;
        return counts;
    }

    /// <summary>Lista para o editor de cenas. <paramref name="scenes"/>: marcadores já carregados (nulo = consulta as cenas).</summary>
    internal static async Task<List<PartySlotView>> ItemsAsync(GameDb db, Guid campaignId, IEnumerable<IEnumerable<SceneToken>>? scenes, CancellationToken ct)
    {
        var rows = await RowsAsync(db, campaignId, ct);
        if (rows.Count == 0) return [];
        var counts = Counts(scenes ?? await SceneTokensAsync(db, campaignId, ct));
        return rows.Select(r => View(r.Slot, r.CharacterName, counts.GetValueOrDefault(r.Slot.Id))).ToList();
    }

    /// <summary>Nome e personagem vinculado de cada reservado, para validar o arranjo (<see cref="ScenePrep.ValidateTokens"/>).</summary>
    internal static async Task<IReadOnlyDictionary<Guid, (string Name, Guid? CharacterId)>> LookupAsync(GameDb db, Guid campaignId, CancellationToken ct) =>
        (await db.PartySlots.AsNoTracking().Where(s => s.CampaignId == campaignId).Select(s => new { s.Id, s.Name, s.CharacterId }).ToListAsync(ct))
            .ToDictionary(s => s.Id, s => (s.Name, s.CharacterId));

    /// <summary>Escrita: bloqueio comum da campanha (mesma ordem de <see cref="PreparationService.SaveSceneAsync"/>) e mestre de campanha aberta.</summary>
    async Task BeginWriteAsync(Guid campaignId, string user, CancellationToken ct)
    {
        await new CampaignAssetsService(db).Lock(campaignId, user, ct);
        await Prep.AccessAsync(campaignId, user, true, true, ct);
    }

    async Task<PartySlot> SlotAsync(Guid campaignId, Guid slotId, CancellationToken ct) =>
        await db.PartySlots.SingleOrDefaultAsync(s => s.Id == slotId && s.CampaignId == campaignId, ct) ?? throw new RuleException(404, "Personagem reservado não encontrado.");

    /// <summary>Nome do personagem vinculado à campanha; 400 se não estiver.</summary>
    async Task<string> LinkedNameAsync(Guid campaignId, Guid characterId, CancellationToken ct) =>
        await db.CampaignCharacters.AsNoTracking().Where(cc => cc.CampaignId == campaignId && cc.CharacterId == characterId)
            .Join(db.Characters, cc => cc.CharacterId, c => c.Id, (cc, c) => c.Name).FirstOrDefaultAsync(ct)
        ?? throw new RuleException(400, "Escolha um personagem vinculado à campanha.");

    static string Cut(string s) => PreparationService.Cut(s, 40);

    public async Task<object> ListAsync(Guid campaignId, string user, CancellationToken ct)
    {
        await Prep.AccessAsync(campaignId, user, true, false, ct);
        var rows = await RowsAsync(db, campaignId, ct);
        Dictionary<Guid, int> counts = rows.Count == 0 ? [] : Counts(await SceneTokensAsync(db, campaignId, ct));
        var slotOf = rows.Where(r => r.Slot.CharacterId != null).ToDictionary(r => r.Slot.CharacterId!.Value, r => r.Slot.Id);
        var characters = await db.CampaignCharacters.AsNoTracking().Where(cc => cc.CampaignId == campaignId)
            .Join(db.Characters, cc => cc.CharacterId, c => c.Id, (cc, c) => new { c.Id, c.Name }).OrderBy(c => c.Name).Take(100).ToListAsync(ct);
        return new
        {
            items = rows.Select(r => View(r.Slot, r.CharacterName, counts.GetValueOrDefault(r.Slot.Id))),
            characters = characters.Select(c => new { c.Id, c.Name, slotId = slotOf.TryGetValue(c.Id, out var s) ? s : (Guid?)null }),
        };
    }

    /// <summary>Valida e aplica nome, arquétipo, imagem (link https ou acervo desta campanha), forma, porte e área.</summary>
    async Task ApplyAsync(Guid campaignId, PartySlot slot, PartySlotInput x, IEnumerable<string> otherNames, CancellationToken ct)
    {
        var name = LibraryService.Clean(x.Name ?? "", false).Trim();
        if (name.Length > 40) throw new RuleException(400, "Dê um nome de até 40 caracteres ao personagem reservado.");
        if (name.Length == 0)
        {
            var used = otherNames.ToHashSet(StringComparer.OrdinalIgnoreCase);
            name = Enumerable.Range(1, MaxSlots + 1).Select(n => $"Aventureiro {n}").First(n => !used.Contains(n));
        }
        slot.Name = name;
        slot.Archetype = PartySlotArchetypes.Normalize(x.Archetype);
        slot.ImageUrl = await PreparationService.ValidImageAsync(campaignId, x.ImageUrl, db, ct);
        slot.Appearance = x.Appearance == null ? null : TokenLooks.Require(x.Appearance);
        slot.Size = x.Size is { } size ? TokenLooks.RequireSize(size) : null;
        (slot.Width, slot.Height) = TokenLooks.RequireSpan(x.Width, x.Height);
        slot.UpdatedAt = Now;
    }

    async Task SaveAsync(CancellationToken ct)
    {
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateConcurrencyException) { throw new RuleException(409, Changed); }
        // Índice único IX_PartySlots_OneCharacter: outro vínculo concorrente ao mesmo personagem.
        catch (DbUpdateException) { throw new RuleException(409, Taken); }
    }

    public async Task<PartySlotView> CreateAsync(Guid campaignId, PartySlotInput x, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await BeginWriteAsync(campaignId, user, ct);
        var existing = await db.PartySlots.AsNoTracking().Where(s => s.CampaignId == campaignId).Select(s => new { s.Name, s.Order }).ToListAsync(ct);
        if (existing.Count >= MaxSlots) throw new RuleException(409, $"A campanha aceita até {MaxSlots} personagens reservados.");
        var slot = new PartySlot { CampaignId = campaignId, Order = existing.Count == 0 ? 0 : existing.Max(s => s.Order) + 1, CreatedAt = Now };
        await ApplyAsync(campaignId, slot, x, existing.Select(s => s.Name), ct);
        db.PartySlots.Add(slot);
        await SaveAsync(ct);
        await tx.CommitAsync(ct);
        return View(slot, null, 0);
    }

    /// <summary>Edita o reservado. Renomear atualiza o nome dos marcadores ainda sem personagem em todas as cenas.</summary>
    public async Task<PartySlotView> UpdateAsync(Guid campaignId, Guid slotId, PartySlotInput x, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await BeginWriteAsync(campaignId, user, ct);
        var slot = await SlotAsync(campaignId, slotId, ct);
        if (slot.Revision != x.Revision) throw new RuleException(409, Changed);
        var others = await db.PartySlots.AsNoTracking().Where(s => s.CampaignId == campaignId && s.Id != slotId).Select(s => s.Name).ToListAsync(ct);
        var oldName = slot.Name;
        await ApplyAsync(campaignId, slot, x, others, ct);
        slot.Revision++;
        var scenes = slot.Name == oldName ? (await ScenesWithAsync(campaignId, slotId, ct)).Count : await EditScenesAsync(campaignId, slotId, list =>
        {
            var changed = false;
            foreach (var t in list.Where(t => t.SlotId == slotId && t.CharacterId == null)) { t.Label = slot.Name; changed = true; }
            return changed;
        }, ct);
        await SaveAsync(ct);
        await tx.CommitAsync(ct);
        return View(slot, await CharacterNameAsync(slot.CharacterId, ct), scenes);
    }

    async Task<string?> CharacterNameAsync(Guid? id, CancellationToken ct) =>
        id is { } cid ? await db.Characters.AsNoTracking().Where(c => c.Id == cid).Select(c => c.Name).FirstOrDefaultAsync(ct) : null;

    /// <summary>Cópia sem personagem e fora das cenas, com a mesma aparência.</summary>
    public async Task<PartySlotView> DuplicateAsync(Guid campaignId, Guid slotId, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await BeginWriteAsync(campaignId, user, ct);
        var source = await db.PartySlots.AsNoTracking().SingleOrDefaultAsync(s => s.Id == slotId && s.CampaignId == campaignId, ct) ?? throw new RuleException(404, "Personagem reservado não encontrado.");
        var orders = await db.PartySlots.AsNoTracking().Where(s => s.CampaignId == campaignId).Select(s => s.Order).ToListAsync(ct);
        if (orders.Count >= MaxSlots) throw new RuleException(409, $"A campanha aceita até {MaxSlots} personagens reservados.");
        var copy = new PartySlot
        {
            CampaignId = campaignId, Name = PreparationService.Cut(source.Name, 32) + " (cópia)", Archetype = source.Archetype, ImageUrl = source.ImageUrl,
            Appearance = source.Appearance, Size = source.Size, Width = source.Width, Height = source.Height, Order = orders.Max() + 1, CreatedAt = Now, UpdatedAt = Now,
        };
        db.PartySlots.Add(copy);
        await SaveAsync(ct);
        await tx.CommitAsync(ct);
        return View(copy, null, 0);
    }

    /// <summary>Exclui o reservado: marcadores sem personagem saem das cenas; os já vinculados continuam como marcadores do personagem.</summary>
    public async Task DeleteAsync(Guid campaignId, Guid slotId, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await BeginWriteAsync(campaignId, user, ct);
        var slot = await SlotAsync(campaignId, slotId, ct);
        await EditScenesAsync(campaignId, slotId, list =>
        {
            var removed = list.RemoveAll(t => t.SlotId == slotId && t.CharacterId == null) > 0;
            var kept = false;
            foreach (var t in list.Where(t => t.SlotId == slotId)) { t.SlotId = null; kept = true; }
            return removed || kept;
        }, ct);
        db.PartySlots.Remove(slot);
        await SaveAsync(ct);
        await tx.CommitAsync(ct);
    }

    sealed record SceneLists(Guid Id, string Name, List<SceneToken> Prepared, List<SceneToken> Saved);

    /// <summary>Cenas da campanha com marcador do reservado (projeção somente leitura, sem a composição visual).</summary>
    async Task<List<SceneLists>> ScenesWithAsync(Guid campaignId, Guid slotId, CancellationToken ct) =>
        (await db.Scenes.AsNoTracking().Where(s => s.CampaignId == campaignId).Take(PreparationService.MaxScenes).Select(s => new { s.Id, s.Name, s.Prepared, s.Saved }).ToListAsync(ct))
            .Where(s => s.Prepared.Any(t => t.SlotId == slotId) || s.Saved.Any(t => t.SlotId == slotId))
            .Select(s => new SceneLists(s.Id, s.Name, s.Prepared, s.Saved)).ToList();

    /// <summary>
    /// Aplica <paramref name="edit"/> a cópias dos arranjos preparado e salvo das cenas com o reservado; cenas alteradas ganham nova revisão.
    /// Devolve quantas cenas tinham o reservado antes da mudança.
    /// </summary>
    async Task<int> EditScenesAsync(Guid campaignId, Guid slotId, Func<List<SceneToken>, bool> edit, CancellationToken ct)
    {
        var ids = (await ScenesWithAsync(campaignId, slotId, ct)).Select(s => s.Id).ToList();
        if (ids.Count == 0) return 0;
        foreach (var scene in await db.Scenes.Where(s => ids.Contains(s.Id) && s.CampaignId == campaignId).ToListAsync(ct))
        {
            var prepared = scene.Prepared.Select(ScenePrep.Clone).ToList();
            var saved = scene.Saved.Select(ScenePrep.Clone).ToList();
            var a = edit(prepared);
            var b = edit(saved);
            if (!a && !b) continue;
            if (a) scene.Prepared = prepared;
            if (b) scene.Saved = saved;
            scene.Revision++; scene.UpdatedAt = Now;
        }
        return ids.Count;
    }

    /// <summary>Na lista, o reservado e outro marcador do mesmo personagem convivem (seria duplicado ao vincular)?</summary>
    static bool Conflicts(List<SceneToken> list, Guid slotId, Guid characterId) =>
        list.Any(t => t.SlotId == slotId) && list.Any(t => t.SlotId != slotId && t.CharacterId == characterId);

    /// <summary>Prévia do vínculo (somente leitura): cenas afetadas, conflitos, vínculo existente e sessão ao vivo.</summary>
    public async Task<object> BindPreviewAsync(Guid campaignId, Guid slotId, PartyBindPreviewInput x, string user, CancellationToken ct)
    {
        await Prep.AccessAsync(campaignId, user, true, false, ct);
        if (!await db.PartySlots.AnyAsync(s => s.Id == slotId && s.CampaignId == campaignId, ct)) throw new RuleException(404, "Personagem reservado não encontrado.");
        var name = await LinkedNameAsync(campaignId, x.CharacterId, ct);
        var scenes = await ScenesWithAsync(campaignId, slotId, ct);
        var elsewhere = await db.PartySlots.AsNoTracking().Where(s => s.CampaignId == campaignId && s.CharacterId == x.CharacterId && s.Id != slotId)
            .Select(s => new { slotId = s.Id, s.Name }).FirstOrDefaultAsync(ct);
        return new
        {
            characterName = name,
            scenes = scenes.Count,
            conflicts = scenes.Where(s => Conflicts(s.Prepared, slotId, x.CharacterId) || Conflicts(s.Saved, slotId, x.CharacterId)).Select(s => new { sceneId = s.Id, sceneName = s.Name }),
            boundElsewhere = elsewhere,
            activeSession = await db.Sessions.AnyAsync(s => s.CampaignId == campaignId && s.EndedAt == null, ct),
        };
    }

    /// <summary>
    /// Vincula o reservado a um personagem real da campanha mantendo posição, forma, porte, área e camada dos marcadores preparados.
    /// Conflito (o personagem já tem marcador próprio numa cena com o reservado) exige <c>Resolve</c>. A mesa ao vivo não muda.
    /// </summary>
    public async Task<PartySlotView> BindCharacterAsync(Guid campaignId, Guid slotId, PartyBindInput x, string user, CancellationToken ct)
    {
        if (x.Resolve is not (null or "slot" or "character")) throw new RuleException(400, "Escolha qual marcador manter: o do reservado ou o do personagem.");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await BeginWriteAsync(campaignId, user, ct);
        var slot = await SlotAsync(campaignId, slotId, ct);
        if (slot.Revision != x.Revision) throw new RuleException(409, Changed);
        var c = x.CharacterId;
        var name = Cut(await LinkedNameAsync(campaignId, c, ct));
        if (slot.CharacterId is { } current && current != c) throw new RuleException(409, "Desvincule o personagem atual antes de vincular outro.");
        if (await db.PartySlots.AnyAsync(s => s.CampaignId == campaignId && s.CharacterId == c && s.Id != slotId, ct)) throw new RuleException(409, Taken);
        var conflicts = (await ScenesWithAsync(campaignId, slotId, ct)).Count(s => Conflicts(s.Prepared, slotId, c) || Conflicts(s.Saved, slotId, c));
        if (conflicts > 0 && x.Resolve == null)
            throw new RuleException(409, conflicts == 1 ? "O personagem já tem marcador em 1 cena com este reservado. Escolha qual marcador manter."
                : $"O personagem já tem marcador em {conflicts} cenas com este reservado. Escolha qual marcador manter.");
        var scenes = await EditScenesAsync(campaignId, slotId, list =>
        {
            if (list.FirstOrDefault(t => t.SlotId == slotId) is not { } mine) return false;
            var others = list.Where(t => t != mine && t.CharacterId == c).ToList();
            if (others.Count > 0 && x.Resolve == "character")
            {
                // Fica o marcador do personagem (com o vínculo ao reservado); sai o do reservado.
                list.Remove(mine);
                var keep = others[0];
                foreach (var extra in others.Skip(1)) list.Remove(extra);
                keep.SlotId = slotId; keep.Label = name; keep.Side = "ally"; keep.Hidden = false; keep.MasterCharacterId = null;
                return true;
            }
            foreach (var other in others) list.Remove(other);
            mine.CharacterId = c; mine.Label = name; mine.Side = "ally"; mine.Hidden = false; mine.MasterCharacterId = null;
            mine.ImageUrl = x.KeepImage ? mine.ImageUrl ?? slot.ImageUrl : null;
            return true;
        }, ct);
        slot.CharacterId = c; slot.Revision++; slot.UpdatedAt = Now;
        var active = await db.Sessions.AnyAsync(s => s.CampaignId == campaignId && s.EndedAt == null, ct);
        await SaveAsync(ct);
        await tx.CommitAsync(ct);
        return View(slot, name, scenes, active);
    }

    /// <summary>Desfaz o vínculo: os marcadores voltam a ser do reservado (nome do reservado; imagem mantida).</summary>
    public async Task<PartySlotView> UnbindAsync(Guid campaignId, Guid slotId, PartyUnbindInput x, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await BeginWriteAsync(campaignId, user, ct);
        var slot = await SlotAsync(campaignId, slotId, ct);
        if (slot.Revision != x.Revision) throw new RuleException(409, Changed);
        var scenes = await EditScenesAsync(campaignId, slotId, list =>
        {
            var changed = false;
            foreach (var t in list.Where(t => t.SlotId == slotId))
            {
                t.CharacterId = null; t.MasterCharacterId = null; t.Label = slot.Name; t.Side = "ally"; t.Hidden = false;
                changed = true;
            }
            return changed;
        }, ct);
        slot.CharacterId = null; slot.Revision++; slot.UpdatedAt = Now;
        await SaveAsync(ct);
        await tx.CommitAsync(ct);
        return View(slot, null, scenes);
    }
}
