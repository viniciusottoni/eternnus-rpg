using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

/// <summary>
/// Retrato da ficha de jogador (ADR-097). Leitura segue <see cref="CharacterSheets.Readable"/> (dono, mestre das campanhas
/// vinculadas e membros quando a ficha é compartilhada). Envio e remoção são só do dono. Não muda a revisão da ficha.
/// </summary>
public class CharacterPortraitService(GameDb db, TimeProvider clock)
{
    static RuleException NotFound() => new(404, "Imagem não encontrada.");

    public async Task<CharacterPortrait> GetAsync(Guid id, string user, CancellationToken ct)
    {
        if (!await CharacterSheets.Readable(db, user).AnyAsync(c => c.Id == id && c.PortraitVersion > 0, ct)) throw NotFound();
        return await db.Set<CharacterPortrait>().AsNoTracking().SingleOrDefaultAsync(p => p.CharacterId == id, ct) ?? throw NotFound();
    }

    async Task EnsureOwnerAsync(Guid id, string user, CancellationToken ct)
    {
        var owner = await db.Characters.Where(c => c.Id == id).Select(c => c.OwnerId).SingleOrDefaultAsync(ct);
        // Quem não lê a ficha recebe 404; quem lê mas não é dono recebe 403.
        if (owner == null || (owner != user && !await CharacterSheets.Readable(db, user).AnyAsync(x => x.Id == id, ct))) throw new RuleException(404, "Ficha não encontrada.");
        if (owner != user) throw new RuleException(403, "Somente o dono da ficha pode trocar a imagem do personagem.");
    }

    /// <summary>Incrementa/zera a versão sem tocar em <see cref="Character.Revision"/>: trocar a imagem não conflita com a edição da ficha.</summary>
    Task<int> SetVersionAsync(Guid id, bool remove, CancellationToken ct) => remove
        ? db.Characters.Where(c => c.Id == id).ExecuteUpdateAsync(s => s.SetProperty(c => c.PortraitVersion, 0), ct)
        : db.Characters.Where(c => c.Id == id).ExecuteUpdateAsync(s => s.SetProperty(c => c.PortraitVersion, c => c.PortraitVersion + 1), ct);

    /// <summary>Reprocessa (sem metadados, até <see cref="CharacterPortraitModel.MaxSide"/> px; PNG com transparência continua PNG) e substitui.</summary>
    public async Task<object> SaveAsync(Guid id, string user, UploadedDocument image, CancellationToken ct)
    {
        await EnsureOwnerAsync(id, user, ct);
        var (bytes, width, height) = await CampaignAssetsService.Normalize(image, ct, keepAlpha: true, maxSide: CharacterPortraitModel.MaxSide);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var portrait = await db.Set<CharacterPortrait>().SingleOrDefaultAsync(p => p.CharacterId == id, ct);
        // Retrato ocupa o espaço da conta do dono da ficha (ADR-102); a troca conta só a diferença.
        await AccountLimits.EnsureStorageAsync(db, user, bytes.LongLength - (portrait?.Size ?? 0), ct);
        if (portrait == null) db.Add(portrait = new CharacterPortrait { CharacterId = id });
        portrait.Content = bytes;
        portrait.ContentType = CampaignAssetsService.ImageType(bytes);
        portrait.Width = width;
        portrait.Height = height;
        portrait.Size = bytes.LongLength;
        portrait.Sha256 = Convert.ToHexStringLower(SHA256.HashData(bytes));
        portrait.UpdatedAt = clock.GetUtcNow().UtcDateTime;
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException) { throw new RuleException(409, "A imagem foi alterada em outra janela. Recarregue a ficha e tente novamente."); }
        await SetVersionAsync(id, false, ct);
        var version = await db.Characters.Where(c => c.Id == id).Select(c => c.PortraitVersion).SingleAsync(ct);
        await tx.CommitAsync(ct);
        return View(version, portrait);
    }

    public async Task<object> DeleteAsync(Guid id, string user, CancellationToken ct)
    {
        await EnsureOwnerAsync(id, user, ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await db.Set<CharacterPortrait>().Where(p => p.CharacterId == id).ExecuteDeleteAsync(ct);
        await SetVersionAsync(id, true, ct);
        await tx.CommitAsync(ct);
        return View(0, null);
    }

    static object View(int version, CharacterPortrait? p) => new { portraitVersion = version, width = p?.Width, height = p?.Height, size = p?.Size };
}
