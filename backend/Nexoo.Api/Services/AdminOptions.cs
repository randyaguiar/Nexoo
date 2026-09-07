namespace Nexoo.Api.Services;

public class AdminOptions
{
    public const string SectionName = "Admin";

    public string Email { get; set; } = string.Empty;

    /// <summary>Plain admin password, provided via configuration/secrets. MVP-only single admin account.</summary>
    public string Password { get; set; } = string.Empty;

    /// <summary>Signing key for the admin JWT. Must be at least 32 characters.</summary>
    public string JwtSigningKey { get; set; } = string.Empty;

    public int TokenLifetimeHours { get; set; } = 12;

    /// <summary>Where new-order notifications are sent. Falls back to <see cref="Email"/>.</summary>
    public string? NotificationEmail { get; set; }
}
