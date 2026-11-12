using System.Globalization;
using System.Linq.Expressions;
using System.Text;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

/// <summary>
/// Busca textual simples e segura: o termo vira parâmetro com curingas escapados (nunca SQL montado).
/// Toda busca ignora maiúsculas e acentos ("gargula" encontra "Gárgula"): o padrão é dobrado aqui
/// (<see cref="Fold"/>) e a coluna é dobrada no banco — PostgreSQL usa ILIKE sobre <c>unaccent()</c>
/// (extensão criada por migração); SQLite (testes e desenvolvimento) usa LIKE sobre a função
/// <see cref="SqliteFoldName"/>, registrada na conexão com a mesma regra de <see cref="Fold"/>.
/// </summary>
public static class TextSearch
{
    public const int MinLength = 2, MaxLength = 100;
    public const string Escape = "\\";
    /// <summary>Nome da função de dobra registrada nas conexões SQLite.</summary>
    public const string SqliteFoldName = "eternnus_fold";

    /// <summary>Termo limpo ou null (sem busca). Fora dos limites: 400.</summary>
    public static string? Term(string? input)
    {
        var term = (input ?? "").Trim();
        if (term.Length == 0) return null;
        if (term.Length > MaxLength) throw new RuleException(400, $"A busca aceita até {MaxLength} caracteres.");
        if (term.Length < MinLength) throw new RuleException(400, $"Digite ao menos {MinLength} caracteres para buscar.");
        if (term.Any(ch => char.IsControl(ch))) throw new RuleException(400, "A busca contém caracteres inválidos.");
        return term;
    }

    /// <summary>Texto para comparação: minúsculas e sem acentos ("Gárgula" vira "gargula").</summary>
    public static string Fold(string? text)
    {
        if (string.IsNullOrEmpty(text)) return "";
        var sb = new StringBuilder(text.Length);
        foreach (var rune in text.EnumerateRunes()) AppendFolded(sb, rune);
        return sb.ToString();
    }

    /// <summary>Mesma regra de <see cref="Fold"/>, preservando null; mapeada como função SQL no SQLite.</summary>
    public static string? SqlFold(string? text) => text == null ? null : Fold(text);

    /// <summary>Padrão "%termo%" dobrado (sem acento, minúsculo) com \, % e _ escapados.</summary>
    public static string Pattern(string term) => "%" + Fold(term).Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_") + "%";

    /// <summary>Predicado "algum dos campos contém o padrão".</summary>
    public static Expression<Func<T, bool>> AnyField<T>(GameDb db, string pattern, params Expression<Func<T, string>>[] fields)
    {
        var parameter = Expression.Parameter(typeof(T), "x");
        Expression? body = null;
        foreach (var field in fields)
        {
            var value = new Replace(field.Parameters[0], parameter).Visit(field.Body)!;
            var match = Matches(db, value, pattern);
            body = body == null ? match : Expression.OrElse(body, match);
        }
        return Expression.Lambda<Func<T, bool>>(body ?? Expression.Constant(false), parameter);
    }

    /// <summary>Junta dois predicados com OU (mesmo tipo).</summary>
    public static Expression<Func<T, bool>> Or<T>(Expression<Func<T, bool>> a, Expression<Func<T, bool>> b)
    {
        var body = Expression.OrElse(a.Body, new Replace(b.Parameters[0], a.Parameters[0]).Visit(b.Body)!);
        return Expression.Lambda<Func<T, bool>>(body, a.Parameters[0]);
    }

    static readonly System.Reflection.MethodInfo LikeMethod = typeof(DbFunctionsExtensions).GetMethod(nameof(DbFunctionsExtensions.Like), [typeof(DbFunctions), typeof(string), typeof(string), typeof(string)])!;
    static readonly System.Reflection.MethodInfo ILikeMethod = typeof(NpgsqlDbFunctionsExtensions).GetMethod(nameof(NpgsqlDbFunctionsExtensions.ILike), [typeof(DbFunctions), typeof(string), typeof(string), typeof(string)])!;
    static readonly System.Reflection.MethodInfo UnaccentMethod = typeof(NpgsqlFullTextSearchDbFunctionsExtensions).GetMethod(nameof(NpgsqlFullTextSearchDbFunctionsExtensions.Unaccent), [typeof(DbFunctions), typeof(string)])!;
    static readonly System.Reflection.MethodInfo FoldMethod = typeof(TextSearch).GetMethod(nameof(SqlFold))!;

    /// <summary>Comparação sem caixa nem acento com o padrão como parâmetro (capturado num fechamento, não constante SQL).</summary>
    public static Expression Matches(GameDb db, Expression value, string pattern)
    {
        var holder = new PatternHolder(pattern);
        var parameter = Expression.Property(Expression.Constant(holder), nameof(PatternHolder.Value));
        var functions = Expression.Constant(EF.Functions);
        if (db.Database.IsNpgsql())
            return Expression.Call(ILikeMethod, functions, Expression.Call(UnaccentMethod, functions, value), Expression.Call(UnaccentMethod, functions, parameter), Expression.Constant(Escape));
        RegisterSqliteFold(db);
        return Expression.Call(LikeMethod, functions, Expression.Call(FoldMethod, value), parameter, Expression.Constant(Escape));
    }

    /// <summary>Registra <see cref="SqliteFoldName"/> na conexão SQLite (aberta ou não; o provedor a reaplica a cada abertura).</summary>
    static void RegisterSqliteFold(GameDb db)
    {
        if (db.Database.GetDbConnection() is SqliteConnection connection)
            connection.CreateFunction<string?, string?>(SqliteFoldName, SqlFold, isDeterministic: true);
    }

    /// <summary>Trecho do texto em volta da primeira ocorrência (sem diferenciar caixa nem acento), com até <paramref name="radius"/> caracteres de cada lado.</summary>
    public static string? Excerpt(string? text, string term, int radius = 90)
    {
        if (string.IsNullOrEmpty(text)) return null;
        var needle = Fold(term);
        if (needle.Length == 0) return null;
        var (folded, origin) = FoldWithOrigin(text);
        var at = folded.IndexOf(needle, StringComparison.Ordinal);
        if (at < 0) return null;
        var first = origin[at];
        var last = origin[at + needle.Length - 1];
        var matchEnd = last + (char.IsHighSurrogate(text[last]) && last + 1 < text.Length ? 2 : 1);
        var start = Math.Max(0, first - radius);
        var end = Math.Min(text.Length, matchEnd + radius);
        var slice = text[start..end].Replace('\r', ' ').Replace('\n', ' ').Trim();
        return (start > 0 ? "…" : "") + slice + (end < text.Length ? "…" : "");
    }

    /// <summary>Texto dobrado com a posição original (UTF-16) de cada caractere resultante.</summary>
    static (string Folded, List<int> Origin) FoldWithOrigin(string text)
    {
        var sb = new StringBuilder(text.Length);
        var origin = new List<int>(text.Length);
        var index = 0;
        foreach (var rune in text.EnumerateRunes())
        {
            var before = sb.Length;
            AppendFolded(sb, rune);
            for (var i = before; i < sb.Length; i++) origin.Add(index);
            index += rune.Utf16SequenceLength;
        }
        return (sb.ToString(), origin);
    }

    static void AppendFolded(StringBuilder sb, Rune rune)
    {
        foreach (var ch in rune.ToString().Normalize(NormalizationForm.FormD))
            if (CharUnicodeInfo.GetUnicodeCategory(ch) != UnicodeCategory.NonSpacingMark) sb.Append(char.ToLowerInvariant(ch));
    }

    sealed class PatternHolder(string value) { public string Value { get; } = value; }
    sealed class Replace(ParameterExpression from, ParameterExpression to) : ExpressionVisitor
    {
        protected override Expression VisitParameter(ParameterExpression node) => node == from ? to : base.VisitParameter(node);
    }
}
