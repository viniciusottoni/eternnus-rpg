using System.Linq.Expressions;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

/// <summary>
/// Busca textual simples e segura: o termo vira parâmetro com curingas escapados (nunca SQL montado).
/// PostgreSQL usa ILIKE (sem diferenciar maiúsculas); outros provedores (testes SQLite) usam LIKE.
/// </summary>
public static class TextSearch
{
    public const int MinLength = 2, MaxLength = 100;
    public const string Escape = "\\";

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

    /// <summary>Padrão "%termo%" com \, % e _ escapados.</summary>
    public static string Pattern(string term) => "%" + term.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_") + "%";

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

    /// <summary>Chamada ILIKE/LIKE com o padrão como parâmetro (capturado num fechamento, não constante SQL).</summary>
    public static Expression Matches(GameDb db, Expression value, string pattern)
    {
        var holder = new PatternHolder(pattern);
        var parameter = Expression.Property(Expression.Constant(holder), nameof(PatternHolder.Value));
        return Expression.Call(db.Database.IsNpgsql() ? ILikeMethod : LikeMethod, Expression.Constant(EF.Functions), value, parameter, Expression.Constant(Escape));
    }

    /// <summary>Trecho do texto em volta da primeira ocorrência (sem diferenciar maiúsculas), com até <paramref name="radius"/> caracteres de cada lado.</summary>
    public static string? Excerpt(string? text, string term, int radius = 90)
    {
        if (string.IsNullOrEmpty(text)) return null;
        var i = text.IndexOf(term, StringComparison.CurrentCultureIgnoreCase);
        if (i < 0) return null;
        var start = Math.Max(0, i - radius);
        var end = Math.Min(text.Length, i + term.Length + radius);
        var slice = text[start..end].Replace('\r', ' ').Replace('\n', ' ').Trim();
        return (start > 0 ? "…" : "") + slice + (end < text.Length ? "…" : "");
    }

    sealed class PatternHolder(string value) { public string Value { get; } = value; }
    sealed class Replace(ParameterExpression from, ParameterExpression to) : ExpressionVisitor
    {
        protected override Expression VisitParameter(ParameterExpression node) => node == from ? to : base.VisitParameter(node);
    }
}
