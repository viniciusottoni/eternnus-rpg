using System.Globalization;
using System.Text;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

/// <summary>
/// Leitor CSV (RFC 4180) mínimo e sem avaliação de conteúdo: aspas, aspas duplicadas e quebras de linha dentro de campos.
/// O delimitador (; , ou tabulação) vem da linha de cabeçalho. Cada registro guarda a linha física em que começa.
/// </summary>
public static class CsvTable
{
    public static List<(int Line, string[] Cells)> Parse(string text, int maxRecords, int maxCells = 100)
    {
        var header = text.Split('\n', 2)[0];
        var delimiter = new[] { ';', ',', '\t' }.OrderByDescending(d => header.Count(ch => ch == d)).First();
        var records = new List<(int, string[])>();
        var cells = new List<string>();
        var cell = new StringBuilder();
        int line = 1, start = 1, i = 0;
        bool quoted = false, any = false;
        void EndCell()
        {
            if (cells.Count >= maxCells) throw new RuleException(400, $"Linha {start}: colunas demais (até {maxCells}).");
            cells.Add(cell.ToString()); cell.Clear();
        }
        void EndRecord()
        {
            EndCell();
            if (cells.Any(c => c.Length > 0))
            {
                if (records.Count >= maxRecords) throw new RuleException(400, $"O arquivo aceita até {maxRecords - 1} linhas de dados.");
                records.Add((start, cells.ToArray()));
            }
            cells.Clear(); any = false;
        }
        while (i < text.Length)
        {
            var ch = text[i];
            if (quoted)
            {
                if (ch == '"')
                {
                    if (i + 1 < text.Length && text[i + 1] == '"') { cell.Append('"'); i += 2; continue; }
                    quoted = false; i++; continue;
                }
                if (ch == '\n') line++;
                if (ch != '\r') cell.Append(ch);
                i++; continue;
            }
            if (ch == '"' && cell.Length == 0) { quoted = true; any = true; i++; continue; }
            if (ch == delimiter) { EndCell(); any = true; i++; continue; }
            if (ch == '\r') { i++; continue; }
            if (ch == '\n') { EndRecord(); line++; start = line; i++; continue; }
            if (!any) { any = true; start = line; }
            cell.Append(ch); i++;
        }
        if (quoted) throw new RuleException(400, $"Linha {start}: aspas sem fechamento.");
        if (any || cell.Length > 0 || cells.Count > 0) EndRecord();
        return records;
    }
}

/// <summary>Plano de importação: o que será criado e os erros por linha. Nada é gravado sem confirmação e sem erros.</summary>
public sealed record SessionImportPlan(List<SessionImportPlan.Chapter> Chapters, List<SessionImportPlan.Session> Sessions, List<SessionImportPlan.Problem> Errors)
{
    public sealed record Chapter(string Title, string Kind, string Summary, Guid? ExistingId, int Line);
    public sealed record Session(int Line, int Number, string Title, DateOnly? Date, bool Published, string Summary, List<PastSessionScene> Scenes, string? ChapterTitle);
    public sealed record Problem(int Line, string Message);
}

/// <summary>Importação em lote de capítulos e sessões anteriores a partir do modelo CSV baixado no site.</summary>
public static class SessionImportFormat
{
    public const int MaxBytes = 1024 * 1024, MaxRows = 1000, TemplateScenes = 5;
    public const string FileName = "modelo-sessoes-eternnus.csv", ExamplePrefix = "(exemplo)";
    static readonly string[] Base = ["tipo_capitulo", "capitulo", "resumo_capitulo", "numero", "titulo", "data", "publicado", "resumo"];

    static SessionImportFormat() => Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

    /// <summary>Modelo estático (UTF-8 com BOM, separado por ponto e vírgula para abrir no Excel em português). Linhas de exemplo são recusadas até serem apagadas.</summary>
    public static byte[] Template()
    {
        var header = Base.Concat(Enumerable.Range(1, TemplateScenes).SelectMany(n => new[] { $"cena_{n}_titulo", $"cena_{n}_texto" }));
        var pad = new string(';', TemplateScenes * 2 - 2);
        var text = string.Join(";", header) + "\r\n"
            + $"ato;{ExamplePrefix} Trevas;Os heróis descobrem a ameaça.;1;{ExamplePrefix} Blackstones;13/11/2019;sim;\"Resumo geral da sessão.\nPode ter várias linhas.\";A chegada;O grupo chega à vila.{pad}\r\n"
            + $"ato;{ExamplePrefix} Trevas;;2;{ExamplePrefix} Rosered;27/11/2019;não;;Batalha na floresta;Goblins atacam a carroça.;Uma estranha caverna;Um portão de ferro.{new string(';', TemplateScenes * 2 - 4)}\r\n"
            + $"arco;{ExamplePrefix} Fogo;Capítulo ainda sem sessões: deixe número e título vazios.;;;;;{new string(';', TemplateScenes * 2)}\r\n";
        return [.. Encoding.UTF8.GetPreamble(), .. Encoding.UTF8.GetBytes(text)];
    }

    /// <summary>UTF-8 estrito; se o Excel salvou em Windows-1252, lê como tal. Recusa bytes nulos e caracteres de controle.</summary>
    public static string Decode(byte[] bytes)
    {
        if (bytes.Length == 0) throw new RuleException(400, "O arquivo está vazio.");
        if (bytes.Length > MaxBytes) throw new RuleException(413, "O arquivo aceita até 1 MB.");
        if (Array.IndexOf(bytes, (byte)0) >= 0) throw new RuleException(400, "Envie o modelo em CSV (texto). Planilhas .xlsx não são aceitas; use Salvar como › CSV UTF-8.");
        string text;
        try { text = new UTF8Encoding(false, true).GetString(bytes); }
        catch (DecoderFallbackException) { text = Encoding.GetEncoding(1252).GetString(bytes); }
        text = text.TrimStart('﻿');
        if (text.Any(ch => ch < ' ' && ch is not ('\t' or '\r' or '\n') || ch == '\u007f' || ch is >= '‪' and <= '‮' || ch is >= '⁦' and <= '⁩'))
            throw new RuleException(400, "O arquivo contém caracteres de controle. Use o modelo baixado no site.");
        return text;
    }

    static string Header(string value)
    {
        var plain = new string(value.Trim().ToLowerInvariant().Normalize(NormalizationForm.FormD).Where(ch => CharUnicodeInfo.GetUnicodeCategory(ch) != UnicodeCategory.NonSpacingMark).ToArray());
        return string.Join("_", plain.Split([' ', '-', '_'], StringSplitOptions.RemoveEmptyEntries));
    }

    static string? Kind(string value) => Header(value) switch
    {
        "" or "capitulo" or "chapter" => ChapterKinds.Chapter,
        "ato" or "act" => ChapterKinds.Act,
        "arco" or "arc" => ChapterKinds.Arc,
        _ => null,
    };

    static bool? Flag(string value) => Header(value) switch
    {
        "" or "nao" or "n" or "false" or "0" or "no" => false,
        "sim" or "s" or "true" or "1" or "yes" => true,
        _ => null,
    };

    static readonly string[] DateFormats = ["dd/MM/yyyy", "d/M/yyyy", "yyyy-MM-dd"];

    /// <summary>Lê o texto e valida cada linha isoladamente (sem banco). Erros não interrompem a leitura das demais linhas.</summary>
    public static SessionImportPlan Read(string text, DateOnly today)
    {
        var records = CsvTable.Parse(text, MaxRows + 1);
        var errors = new List<SessionImportPlan.Problem>();
        var chapters = new List<SessionImportPlan.Chapter>();
        var sessions = new List<SessionImportPlan.Session>();
        if (records.Count == 0) { errors.Add(new(1, "O arquivo está vazio.")); return new(chapters, sessions, errors); }
        var headers = records[0].Cells.Select(Header).ToArray();
        int Col(string name) => Array.IndexOf(headers, name);
        foreach (var name in new[] { "numero", "titulo" }) if (Col(name) < 0) errors.Add(new(records[0].Line, $"Coluna obrigatória ausente: {name}. Baixe o modelo novamente."));
        var unknown = headers.Where(h => h.Length > 0 && !Base.Contains(h) && !System.Text.RegularExpressions.Regex.IsMatch(h, "^cena_([1-9]|[12][0-9]|30)_(titulo|texto)$")).ToList();
        if (unknown.Count > 0) errors.Add(new(records[0].Line, "Colunas desconhecidas: " + string.Join(", ", unknown.Take(5)) + "."));
        if (headers.Where(h => h.Length > 0).GroupBy(h => h).Any(g => g.Count() > 1)) errors.Add(new(records[0].Line, "Há colunas repetidas no cabeçalho."));
        if (errors.Count > 0) return new(chapters, sessions, errors);
        var sceneNumbers = headers.Select(h => System.Text.RegularExpressions.Regex.Match(h, "^cena_(\\d+)_")).Where(m => m.Success).Select(m => int.Parse(m.Groups[1].Value)).Distinct().Order().ToList();
        var numbers = new Dictionary<int, int>();
        foreach (var (line, cells) in records.Skip(1))
        {
            string Get(string name) { var i = Col(name); return i >= 0 && i < cells.Length ? cells[i].Trim() : ""; }
            if (cells.Length > headers.Length && cells.Skip(headers.Length).Any(c => c.Trim().Length > 0)) { errors.Add(new(line, "Há mais valores do que colunas no cabeçalho.")); continue; }
            var chapterTitle = Get("capitulo"); var title = Get("titulo"); var number = Get("numero");
            if (chapterTitle.StartsWith(ExamplePrefix, StringComparison.OrdinalIgnoreCase) || title.StartsWith(ExamplePrefix, StringComparison.OrdinalIgnoreCase)) { errors.Add(new(line, "Linha de exemplo do modelo: apague antes de importar.")); continue; }
            if (chapterTitle.Length > 0)
            {
                var kind = Kind(Get("tipo_capitulo"));
                var summary = Get("resumo_capitulo");
                if (chapterTitle.Length > 120) { errors.Add(new(line, "O título do capítulo aceita até 120 caracteres.")); continue; }
                if (kind == null) { errors.Add(new(line, "tipo_capitulo deve ser capítulo, ato ou arco.")); continue; }
                if (summary.Length > 2000) { errors.Add(new(line, "O resumo do capítulo aceita até 2.000 caracteres.")); continue; }
                if (!chapters.Any(x => string.Equals(x.Title, chapterTitle, StringComparison.OrdinalIgnoreCase))) chapters.Add(new(chapterTitle, kind, summary, null, line));
            }
            else if (Get("tipo_capitulo").Length > 0 || Get("resumo_capitulo").Length > 0) { errors.Add(new(line, "Informe o nome do capítulo na coluna capitulo.")); continue; }
            if (number.Length == 0 && title.Length == 0)
            {
                if (chapterTitle.Length == 0 || new[] { "data", "publicado", "resumo" }.Any(n => Get(n).Length > 0) || sceneNumbers.Any(n => Get($"cena_{n}_titulo").Length + Get($"cena_{n}_texto").Length > 0))
                    errors.Add(new(line, "Informe número e título da sessão."));
                continue;
            }
            if (!int.TryParse(number, NumberStyles.None, CultureInfo.InvariantCulture, out var n) || n is < 1 or > 1000000) { errors.Add(new(line, "Número da sessão deve ser inteiro entre 1 e 1.000.000.")); continue; }
            if (title.Length is 0 or > 120) { errors.Add(new(line, "Título da sessão é obrigatório (até 120 caracteres).")); continue; }
            if (numbers.TryGetValue(n, out var first)) { errors.Add(new(line, $"Sessão {n} repetida (já aparece na linha {first}).")); continue; }
            DateOnly? date = null;
            if (Get("data") is { Length: > 0 } rawDate)
            {
                if (!DateOnly.TryParseExact(rawDate, DateFormats, CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed)) { errors.Add(new(line, "Data deve estar em dd/mm/aaaa.")); continue; }
                if (parsed > today.AddDays(1)) { errors.Add(new(line, "A data não pode estar no futuro.")); continue; }
                date = parsed;
            }
            if (Flag(Get("publicado")) is not { } published) { errors.Add(new(line, "publicado deve ser sim ou não.")); continue; }
            var resumo = Get("resumo");
            if (resumo.Length > 10000) { errors.Add(new(line, "O resumo aceita até 10.000 caracteres.")); continue; }
            List<PastSessionScene> scenes;
            try { scenes = WorkspaceService.PastScenes(sceneNumbers.Select(k => new PastSceneInput(Get($"cena_{k}_titulo"), Get($"cena_{k}_texto"))).ToList()); }
            catch (RuleException e) { errors.Add(new(line, e.Message)); continue; }
            numbers[n] = line;
            sessions.Add(new(line, n, title, date, published, resumo, scenes, chapterTitle.Length > 0 ? chapterTitle : null));
        }
        if (sessions.Count == 0 && chapters.Count == 0 && errors.Count == 0) errors.Add(new(records[0].Line, "Nenhuma linha para importar."));
        return new(chapters, sessions, errors);
    }
}

public sealed partial class WorkspaceService
{
    /// <summary>
    /// Prévia (<paramref name="confirm"/> falso) ou gravação de uma importação. Confere números e limites contra o banco sob o
    /// bloqueio da campanha; grava tudo numa transação ou nada. Capítulos com o mesmo título (sem diferenciar maiúsculas) são reutilizados.
    /// </summary>
    public async Task<object> ImportSessions(Guid campaign, string user, byte[] bytes, bool confirm, CancellationToken ct)
    {
        var text = SessionImportFormat.Decode(bytes);
        var plan = SessionImportFormat.Read(text, DateOnly.FromDateTime(DateTime.UtcNow));
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var c = await Lock(campaign, user, ct);
        if (c.OwnerId != user) throw new RuleException(403, "Somente o mestre importa sessões.");
        var errors = plan.Errors.ToList();
        var existing = await Chapters.Where(x => x.CampaignId == campaign).Select(x => new { x.Id, x.Title }).ToListAsync(ct);
        var chapters = plan.Chapters.Select(x => x with { ExistingId = existing.FirstOrDefault(e => string.Equals(e.Title, x.Title, StringComparison.OrdinalIgnoreCase))?.Id }).ToList();
        var newChapters = chapters.Count(x => x.ExistingId == null);
        if (existing.Count + newChapters > ChapterModel.MaxPerCampaign) errors.Add(new(1, $"A campanha ficaria com mais de {ChapterModel.MaxPerCampaign} capítulos."));
        var numbers = plan.Sessions.Select(s => s.Number).ToList();
        var taken = (await db.Sessions.Where(s => s.CampaignId == campaign && numbers.Contains(s.Number)).Select(s => s.Number).ToListAsync(ct))
            .Concat(await db.Set<PastSession>().Where(s => s.CampaignId == campaign && numbers.Contains(s.Number)).Select(s => s.Number).ToListAsync(ct)).ToHashSet();
        foreach (var s in plan.Sessions.Where(s => taken.Contains(s.Number))) errors.Add(new(s.Line, $"Já existe uma sessão {s.Number} nesta campanha."));
        if (await db.Set<PastSession>().CountAsync(p => p.CampaignId == campaign, ct) + plan.Sessions.Count > 1000) errors.Add(new(1, "A campanha ficaria com mais de 1.000 sessões anteriores."));
        var preview = new
        {
            chapters = chapters.Select(x => new { x.Line, x.Title, x.Kind, existing = x.ExistingId != null }),
            sessions = plan.Sessions.Select(s => new { s.Line, s.Number, s.Title, s.Date, s.Published, chapter = s.ChapterTitle, scenes = s.Scenes.Count, summary = s.Summary.Length > 160 ? s.Summary[..160] + "…" : s.Summary }),
            errors = errors.OrderBy(e => e.Line).Select(e => new { e.Line, e.Message }),
            ready = errors.Count == 0 && (plan.Sessions.Count > 0 || newChapters > 0),
            newChapters, imported = false,
        };
        if (!confirm) { await tx.RollbackAsync(ct); return preview; }
        if (!preview.ready) throw new RuleException(400, errors.Count > 0 ? "Corrija as linhas indicadas na prévia antes de importar." : "Nada novo para importar.");
        var order = (await Chapters.Where(x => x.CampaignId == campaign).MaxAsync(x => (int?)x.Order, ct) ?? -1) + 1;
        var ids = new Dictionary<string, Guid>(StringComparer.OrdinalIgnoreCase);
        foreach (var x in chapters)
        {
            if (x.ExistingId is { } id) { ids[x.Title] = id; continue; }
            var created = new StoryChapter { CampaignId = campaign, Title = x.Title, Kind = x.Kind, Summary = x.Summary, Order = order++, CreatedAt = DateTime.UtcNow };
            db.Add(created); ids[x.Title] = created.Id;
        }
        foreach (var s in plan.Sessions)
            db.Add(new PastSession { CampaignId = campaign, Number = s.Number, Title = s.Title, Summary = s.Summary, Date = s.Date, Published = s.Published, Scenes = s.Scenes, ChapterId = s.ChapterTitle is { } t ? ids[t] : null });
        try { await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); }
        catch (DbUpdateException) { throw new RuleException(409, "Outra alteração usou um destes números. Gere a prévia novamente."); }
        return preview with { imported = true };
    }
}
