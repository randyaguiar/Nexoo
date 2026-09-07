namespace Nexoo.Api.Models;

public class Product
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid BusinessId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public decimal PriceUsd { get; set; }
    public string? PhotoUrl { get; set; }
    public bool Available { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public Business? Business { get; set; }
}
