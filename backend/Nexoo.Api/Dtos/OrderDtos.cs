using System.ComponentModel.DataAnnotations;
using Nexoo.Api.Models;

namespace Nexoo.Api.Dtos;

public class CreateOrderItemInput
{
    [Required]
    public Guid ProductId { get; set; }

    [Range(1, 100)]
    public int Quantity { get; set; }
}

public class CreateOrderInput
{
    [Required, MaxLength(160)]
    public string BuyerName { get; set; } = string.Empty;

    [Required, EmailAddress, MaxLength(200)]
    public string BuyerEmail { get; set; } = string.Empty;

    [Required, MaxLength(40)]
    public string BuyerPhone { get; set; } = string.Empty;

    [Required, MaxLength(160)]
    public string RecipientName { get; set; } = string.Empty;

    [Required, MaxLength(40)]
    public string RecipientPhone { get; set; } = string.Empty;

    [Required]
    public Province RecipientProvince { get; set; }

    [Required, MaxLength(120)]
    public string RecipientMunicipality { get; set; } = string.Empty;

    [Required, MaxLength(500)]
    public string RecipientAddress { get; set; } = string.Empty;

    [MaxLength(1000)]
    public string? Notes { get; set; }

    [Required, MinLength(1)]
    public List<CreateOrderItemInput> Items { get; set; } = new();
}

public record OrderItemDto(Guid Id, Guid ProductId, string ProductName, int Quantity, decimal UnitPrice);

public record OrderDto(
    Guid Id,
    string BuyerName,
    string BuyerEmail,
    string BuyerPhone,
    string RecipientName,
    string RecipientPhone,
    Province RecipientProvince,
    string RecipientMunicipality,
    string RecipientAddress,
    Guid BusinessId,
    string BusinessName,
    OrderStatus Status,
    decimal TotalUsd,
    string? Notes,
    DateTimeOffset CreatedAt,
    IReadOnlyList<OrderItemDto> Items);

public class UpdateOrderStatusInput
{
    [Required]
    public OrderStatus Status { get; set; }
}

public class AdminLoginInput
{
    [Required, EmailAddress]
    public string Email { get; set; } = string.Empty;

    [Required]
    public string Password { get; set; } = string.Empty;
}

public record AdminLoginResult(string Token, DateTimeOffset ExpiresAt);
