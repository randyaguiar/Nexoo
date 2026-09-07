namespace Nexoo.Api.Services;

public static class DatabaseConnectionString
{
    /// <summary>
    /// Resolves the PostgreSQL connection string, accepting either an ADO.NET string or the
    /// postgres:// URI that Supabase, Render and Railway hand out.
    /// </summary>
    public static string Resolve(IConfiguration configuration)
    {
        var raw = FirstNonEmpty(configuration.GetConnectionString("Postgres"), configuration["DATABASE_URL"])
            ?? throw new InvalidOperationException(
                "Missing database configuration. Set ConnectionStrings__Postgres or DATABASE_URL.");

        return IsUri(raw) ? FromUri(raw) : raw;
    }

    private static string? FirstNonEmpty(params string?[] values) =>
        values.FirstOrDefault(v => !string.IsNullOrWhiteSpace(v));

    private static bool IsUri(string value) =>
        value.StartsWith("postgres://", StringComparison.OrdinalIgnoreCase)
        || value.StartsWith("postgresql://", StringComparison.OrdinalIgnoreCase);

    private static string FromUri(string value)
    {
        var uri = new Uri(value);
        var userInfo = uri.UserInfo.Split(':', 2);

        var builder = new Npgsql.NpgsqlConnectionStringBuilder
        {
            Host = uri.Host,
            Port = uri.Port > 0 ? uri.Port : 5432,
            Database = uri.AbsolutePath.TrimStart('/'),
            Username = Uri.UnescapeDataString(userInfo[0]),
            Password = userInfo.Length > 1 ? Uri.UnescapeDataString(userInfo[1]) : null,
            // Managed Postgres providers terminate plaintext connections.
            SslMode = Npgsql.SslMode.Require
        };

        return builder.ConnectionString;
    }
}
