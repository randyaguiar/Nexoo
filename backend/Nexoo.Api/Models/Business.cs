namespace Nexoo.Api.Models;

public class Business
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public Province Province { get; set; }
    public string Municipality { get; set; } = string.Empty;
    public string? ContactPhone { get; set; }
    public bool Active { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public List<Product> Products { get; set; } = new();
}
