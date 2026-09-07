namespace Nexoo.Api.Models;

public class Order
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public string BuyerName { get; set; } = string.Empty;
    public string BuyerEmail { get; set; } = string.Empty;
    public string BuyerPhone { get; set; } = string.Empty;

    public string RecipientName { get; set; } = string.Empty;
    public string RecipientPhone { get; set; } = string.Empty;
    public Province RecipientProvince { get; set; }
    public string RecipientMunicipality { get; set; } = string.Empty;
    public string RecipientAddress { get; set; } = string.Empty;

    public Guid BusinessId { get; set; }
    public OrderStatus Status { get; set; } = OrderStatus.PendingPayment;

    /// <summary>Sum of the order items, computed server-side from current product prices.</summary>
    public decimal TotalUsd { get; set; }

    public string? Notes { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;

    public Business? Business { get; set; }
    public List<OrderItem> Items { get; set; } = new();
}
