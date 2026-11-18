namespace Eternnus.Web;

/// <summary>
/// Aventura de exemplo opcional (N1): conteúdo original do Eternnus semeado na criação da campanha ou da one-shot,
/// dentro da transação do chamador (não confirma nem chama <c>SaveChanges</c>). Os registros são cópias próprias da
/// campanha, com o mestre como dono: uma cena tática na raiz de Cenas, dois personagens do mestre na raiz de
/// Personagens (sem ficha, como "Novo personagem"), uma página de premissa e um objetivo (ADR-063), ambos privados.
/// O mapa é um cenário oficial imutável de <see cref="BattleMaps"/>, referenciado pela chave como em
/// "Nova cena › A partir de mapa"; nenhuma imagem é copiada.
/// Quotas: a conta é conferida antes por <see cref="AccountLimits.ReserveAsync"/> (409 sem gravar nada). O conteúdo
/// cabe sempre nos limites de uma campanha nova (1 de <see cref="PreparationService.MaxScenes"/> cenas,
/// 2 de <see cref="PreparationService.MaxNpcs"/> personagens, 2 de 1.000 páginas) e não usa armazenamento de imagens.
/// </summary>
public static class StarterAdventure
{
    public static readonly BattleMap Map = BattleMaps.Crypt;

    public const string Premise =
        "Há três noites, o sino da velha cripta sob a colina toca à meia-noite, embora ninguém suba à torre há gerações. " +
        "Os moradores de Vau das Pedras pedem a um grupo de forasteiros que descubra quem, ou o quê, perturba o descanso dos antigos.";

    public sealed record Seeded(Guid SceneId, IReadOnlyList<Guid> NpcIds, Guid PremisePageId, Guid ObjectivePageId);

    /// <summary>Adiciona a aventura à campanha recém-criada e preenche a descrição vazia com a premissa.</summary>
    public static async Task<Seeded> SeedAsync(GameDb db, Campaign campaign, DateTime now, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(campaign.Description)) campaign.Description = Premise;
        var scene = new Scene
        {
            CampaignId = campaign.Id, Name = "O sino da cripta", Kind = SceneKinds.Map, MapKind = Map.Kind, MapKey = Map.Key,
            LayerMode = SceneLayerModes.Map, Order = 0, CreatedAt = now, UpdatedAt = now,
            Description = "Cena de exemplo da aventura inicial. Apresente-a na mesa, posicione marcadores e revele as salas aos poucos.",
            SharedText = "Degraus gastos descem até salões de pedra iluminados por braseiros que ninguém acendeu. " +
                "Ao fundo, a corda do sino balança sozinha, e um frio úmido sobe pelas passagens estreitas.",
            PrivateNotes = "Quem toca o sino é o Guardião das Cinzas, preso ao juramento de proteger a cripta. " +
                "Ele só ataca quem mexe nos túmulos. Se o grupo conversar, revela que um ladrão levou o selo de bronze do altar.",
        };
        db.Scenes.Add(scene);
        // Mesma versão automática que a criação de cena pela Preparação registra (ADR-083).
        await DocumentVersionModel.RecordAsync(db, campaign.Id, DocumentVersionKinds.Scene, scene.Id, scene.Revision, DocumentVersionModel.ScenePayload(scene), null, now, ct);

        MasterCharacter Npc(string name, string side, string summary, string notes) => new()
        {
            CampaignId = campaign.Id, Name = name, Side = side, Kind = NpcKinds.Npc, Summary = summary, Notes = notes, CreatedAt = now, UpdatedAt = now,
        };
        var npcs = new[]
        {
            Npc("Irmã Laurinda", "ally", "Zeladora do santuário de Vau das Pedras. Pede ajuda ao grupo e conhece as histórias da cripta.",
                "Sabe onde fica a entrada lateral da cripta. Esconde, por vergonha, que perdeu a chave do portão."),
            Npc("Guardião das Cinzas", "neutral", "Vigia antigo preso ao juramento de proteger a cripta. Toca o sino para pedir socorro.",
                "Hostil só com quem profana os túmulos. Acalma-se se o selo de bronze voltar ao altar."),
        };
        db.MasterCharacters.AddRange(npcs);

        WorkspacePage Page(string kind, string title, string content, bool pinned) => new()
        {
            CampaignId = campaign.Id, OwnerId = campaign.OwnerId, Kind = kind, Title = title, Content = content,
            Visibility = "self", Status = "open", Pinned = pinned, UpdatedAt = now,
        };
        var premise = Page("text", "Premissa: o sino da cripta",
            Premise + "\n\nGanchos: a Irmã Laurinda procura o grupo na estalagem; o portão principal está trancado; " +
            "um ladrão de passagem foi visto com um objeto de bronze. Ajuste nomes e detalhes à sua mesa.", true);
        var objective = Page("objective", "Descobrir quem toca o sino da cripta",
            "Investigar a cripta sob a colina e devolver a paz a Vau das Pedras.", false);
        db.AddRange(premise, objective);
        return new(scene.Id, npcs.Select(n => n.Id).ToList(), premise.Id, objective.Id);
    }
}
