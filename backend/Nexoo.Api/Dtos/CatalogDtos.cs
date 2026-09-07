using System.ComponentModel.DataAnnotations;
using Nexoo.Api.Models;

namespace Nexoo.Api.Dtos;

public record BusinessDto(
    Guid Id,
    string Name,
    string? Description,
    Province Province,
    string Municipality,
    string? ContactPhone,
    bool Active,
    int ProductCount);

public record ProductDto(
    Guid Id,
    Guid BusinessId,
    string Name,
    string? Description,
    decimal PriceUsd,
    string? PhotoUrl,
    bool Available);

public record BusinessDetailDto(BusinessDto Business, IReadOnlyList<ProductDto> Products);

public class BusinessInput
{
    [Required, MaxLength(160)]
    public string Name { get; set; } = string.Empty;

    [MaxLength(2000)]
    public string? Description { get; set; }

    [Required]
    public Province Province { get; set; }

    [Required, MaxLength(120)]
    public string Municipality { get; set; } = string.Empty;

    [MaxLength(40)]
    public string? ContactPhone { get; set; }

    public bool Active { get; set; } = true;
}

public class ProductInput
{
    [Required]
    public Guid BusinessId { get; set; }

    [Required, MaxLength(160)]
    public string Name { get; set; } = string.Empty;

    [MaxLength(2000)]
    public string? Description { get; set; }

    [Range(0.01, 100000)]
    public decimal PriceUsd { get; set; }

    [MaxLength(1000), Url]
    public string? PhotoUrl { get; set; }

    public bool Available { get; set; } = true;
}
