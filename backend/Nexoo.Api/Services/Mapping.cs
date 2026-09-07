using Nexoo.Api.Dtos;
using Nexoo.Api.Models;

namespace Nexoo.Api.Services;

public static class Mapping
{
    public static BusinessDto ToDto(this Business b, int productCount) =>
        new(b.Id, b.Name, b.Description, b.Province, b.Municipality, b.ContactPhone, b.Active, productCount);

    public static ProductDto ToDto(this Product p) =>
        new(p.Id, p.BusinessId, p.Name, p.Description, p.PriceUsd, p.PhotoUrl, p.Available);

    public static OrderDto ToDto(this Order o) =>
        new(o.Id, o.BuyerName, o.BuyerEmail, o.BuyerPhone,
            o.RecipientName, o.RecipientPhone, o.RecipientProvince, o.RecipientMunicipality, o.RecipientAddress,
            o.BusinessId, o.Business?.Name ?? string.Empty, o.Status, o.TotalUsd, o.Notes, o.CreatedAt,
            o.Items.Select(i => new OrderItemDto(i.Id, i.ProductId, i.ProductName, i.Quantity, i.UnitPrice)).ToList());
}
