using System.ComponentModel.DataAnnotations;

namespace Nexoo.Api.Endpoints;

public static class ValidationExtensions
{
    /// <summary>
    /// Minimal APIs in .NET 8 do not run DataAnnotations automatically, so endpoints call this
    /// explicitly and return a standard ValidationProblem when it fails.
    /// </summary>
    public static bool TryValidate(this object model, out IResult problem)
    {
        var results = new List<ValidationResult>();
        if (Validator.TryValidateObject(model, new ValidationContext(model), results, validateAllProperties: true))
        {
            problem = Results.Empty;
            return true;
        }

        var errors = results
            .SelectMany(r => r.MemberNames.DefaultIfEmpty(string.Empty).Select(m => (Member: m, r.ErrorMessage)))
            .GroupBy(x => x.Member)
            .ToDictionary(g => g.Key, g => g.Select(x => x.ErrorMessage ?? "Valor inválido").ToArray());

        problem = Results.ValidationProblem(errors);
        return false;
    }
}
