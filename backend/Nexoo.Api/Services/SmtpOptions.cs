namespace Nexoo.Api.Services;

public class SmtpOptions
{
    public const string SectionName = "Smtp";

    public string? Host { get; set; }
    public int Port { get; set; } = 587;
    public bool UseStartTls { get; set; } = true;
    public string? User { get; set; }
    public string? Password { get; set; }
    public string FromAddress { get; set; } = "no-reply@nexoo.app";
    public string FromName { get; set; } = "Nexoo";

    public bool IsConfigured => !string.IsNullOrWhiteSpace(Host);
}
