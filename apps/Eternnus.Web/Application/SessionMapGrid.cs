using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

/// <summary>Grade do mapa enviado, ajustada com ele na mesa. <c>Revision</c>: revisão do mapa lida pelo mestre.</summary>
public record MapGridInput(int GridPixels, int GridOffsetX, int GridOffsetY, decimal ScaleMeters, int Revision);

/// <summary>
/// Ajuste da grade durante a sessão (ADR-070): o mestre solta uma imagem na mesa e corrige a grade sem tirar o mapa da mesa.
/// Segue o fluxo da mesa: sessão bloqueada → mapa bloqueado, evento privado, revisão e sinal após o commit.
/// Paredes, névoa e explorações continuam nas mesmas casas (a camada se ajusta ao novo tamanho); marcadores fora da
/// nova grade vão para a casa livre mais próxima.
/// </summary>
public partial class SessionService
{
    public async Task<object> SetMapGridAsync(Guid sessionId, MapGridInput x, string user, CancellationToken ct)
    {
        if (x.GridPixels is < 8 or > 1024 || x.ScaleMeters is < 0.01m or > 1000m || decimal.Round(x.ScaleMeters, 2) != x.ScaleMeters)
            throw new RuleException(400, "Grade: 8–1.024 pixels. Escala: 0,01–1.000 metros, até duas casas decimais.");
        if (x.GridOffsetX < 0 || x.GridOffsetY < 0 || x.GridOffsetX >= x.GridPixels || x.GridOffsetY >= x.GridPixels)
            throw new RuleException(400, "O deslocamento da grade vai de 0 até o tamanho do quadrado menos 1 pixel.");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var a = await LockAsync(sessionId, user, ct); RequireMaster(a);
        if (a.Session.MapKind != MapKinds.Tileset || !a.Session.MapKey.StartsWith("asset:", StringComparison.Ordinal) || !Guid.TryParse(a.Session.MapKey[6..], out var mapId))
            throw new RuleException(409, "Só mapas enviados pela campanha e mostrados com grade têm a grade ajustável na mesa.");
        var campaignId = a.Campaign.Id;
        var map = db.Database.IsNpgsql()
            ? await db.Set<CampaignMap>().FromSqlInterpolated($"SELECT * FROM \"CampaignMap\" WHERE \"Id\" = {mapId} AND \"CampaignId\" = {campaignId} FOR UPDATE").SingleOrDefaultAsync(ct)
            : await db.Set<CampaignMap>().SingleOrDefaultAsync(m => m.Id == mapId && m.CampaignId == campaignId, ct);
        if (map == null || !map.HasGrid) throw new RuleException(404, "Mapa com grade não encontrado.");
        if (map.Revision != x.Revision) throw new RuleException(409, "O mapa mudou em outra tela. Recarregue a mesa antes de ajustar a grade.");
        if (map.TileData != null) throw new RuleException(409, "A grade deste mapa é editada em Mapas e cenários.");
        if (x.GridPixels > Math.Min(map.Width, map.Height)) throw new RuleException(400, "O quadrado deve caber na imagem.");
        var rows = CampaignMapView.Grid(map.Width, map.Height, x.GridPixels, x.GridOffsetX, x.GridOffsetY);
        if (map.GridPixels == x.GridPixels && map.GridOffsetX == x.GridOffsetX && map.GridOffsetY == x.GridOffsetY && map.ScaleMeters == x.ScaleMeters)
        {
            await tx.RollbackAsync(ct);
            return new { map.Revision, map.GridPixels, map.GridOffsetX, map.GridOffsetY, map.ScaleMeters, moved = 0 };
        }
        map.GridPixels = x.GridPixels; map.GridOffsetX = x.GridOffsetX; map.GridOffsetY = x.GridOffsetY; map.ScaleMeters = x.ScaleMeters;
        map.Revision++;
        int width = rows[0].Length, height = rows.Length, moved = 0;
        var tokens = await db.SessionTokens.Where(t => t.SessionId == sessionId).ToListAsync(ct);
        var taken = tokens.Where(t => t.X < width && t.Y < height).Select(t => (t.X, t.Y)).ToHashSet();
        foreach (var t in tokens.Where(t => t.X >= width || t.Y >= height).OrderBy(t => t.Label))
        {
            if (NearestFree(Math.Min(t.X, width - 1), Math.Min(t.Y, height - 1), width, height, taken) is not { } spot) continue;
            t.X = spot.X; t.Y = spot.Y; taken.Add(spot); moved++;
        }
        Event(a.Session, user, await NameAsync(user, ct), EventKinds.Map, $"Mestre ajustou a grade do mapa {map.Name}",
            new { mapId, x.GridPixels, x.GridOffsetX, x.GridOffsetY, scaleMeters = x.ScaleMeters, moved }, masterOnly: true);
        // A névoa é recalculada com a grade nova (a leitura do mapa vem do banco, por isso grava antes).
        await db.SaveChangesAsync(ct);
        await RefreshFogAsync(a, user, ct);
        await CommitAsync(tx, a.Session, ct);
        return new { map.Revision, map.GridPixels, map.GridOffsetX, map.GridOffsetY, map.ScaleMeters, moved };
    }

    /// <summary>Casa livre mais próxima (anéis crescentes) dentro da grade.</summary>
    static (int X, int Y)? NearestFree(int x0, int y0, int width, int height, HashSet<(int, int)> taken)
    {
        for (var radius = 0; radius < Math.Max(width, height); radius++)
            for (var y = y0 - radius; y <= y0 + radius; y++)
                for (var x = x0 - radius; x <= x0 + radius; x++)
                    if (x >= 0 && y >= 0 && x < width && y < height && !taken.Contains((x, y))) return (x, y);
        return null;
    }
}
