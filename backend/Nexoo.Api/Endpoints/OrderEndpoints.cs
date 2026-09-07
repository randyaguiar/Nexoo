using Microsoft.EntityFrameworkCore;
using Nexoo.Api.Data;
using Nexoo.Api.Dtos;
using Nexoo.Api.Models;
using Nexoo.Api.Services;

namespace Nexoo.Api.Endpoints;

public static class OrderEndpoints
{
    public static void MapOrderEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/orders").WithTags("Orders");

        group.MapPost("/", async (
            CreateOrderInput input,
            NexooDbContext db,
            IOrderNotifier notifier,
            CancellationToken ct) =>
        {
            if (!input.TryValidate(out var problem))
            {
                return problem;
            }

            foreach (var item in input.Items)
            {
                if (!item.TryValidate(out var itemProblem))
                {
                    return itemProblem;
                }
            }

            // Collapse duplicated lines so the same product cannot appear twice in one order.
            var quantities = input.Items
                .GroupBy(i => i.ProductId)
                .ToDictionary(g => g.Key, g => g.Sum(i => i.Quantity));

            var productIds = quantities.Keys.ToList();
            var products = await db.Products
                .Include(p => p.Business)
                .Where(p => productIds.Contains(p.Id))
                .ToListAsync(ct);

            if (products.Count != quantities.Count)
            {
                return Results.BadRequest(new { error = "Uno o más productos no existen." });
            }

            if (products.Any(p => !p.Available || p.Business is null || !p.Business.Active))
            {
                return Results.BadRequest(new { error = "Uno o más productos ya no están disponibles." });
            }

            // Each business is paid separately, so an order may only contain one business.
            var businessIds = products.Select(p => p.BusinessId).Distinct().ToList();
            if (businessIds.Count > 1)
            {
                return Results.BadRequest(new { error = "Un pedido solo puede contener productos de un mismo negocio." });
            }

            var order = new Order
            {
                BuyerName = input.BuyerName.Trim(),
                BuyerEmail = input.BuyerEmail.Trim(),
                BuyerPhone = input.BuyerPhone.Trim(),
                RecipientName = input.RecipientName.Trim(),
                RecipientPhone = input.RecipientPhone.Trim(),
                RecipientProvince = input.RecipientProvince,
                RecipientMunicipality = input.RecipientMunicipality.Trim(),
                RecipientAddress = input.RecipientAddress.Trim(),
                Notes = string.IsNullOrWhiteSpace(input.Notes) ? null : input.Notes.Trim(),
                BusinessId = businessIds[0],
                Status = OrderStatus.PendingPayment
            };

            foreach (var product in products)
            {
                order.Items.Add(new OrderItem
                {
                    ProductId = product.Id,
                    ProductName = product.Name,
                    Quantity = quantities[product.Id],
                    // Price is taken from the database, never from the client.
                    UnitPrice = product.PriceUsd
                });
            }

            order.TotalUsd = order.Items.Sum(i => i.Quantity * i.UnitPrice);
            order.Business = products[0].Business;

            db.Orders.Add(order);
            await db.SaveChangesAsync(ct);

            await notifier.NotifyNewOrderAsync(order, ct);

            return Results.Created($"/api/orders/{order.Id}", order.ToDto());
        });

        // Public confirmation page lookup: the order id acts as the (unguessable) access token.
        group.MapGet("/{id:guid}", async (Guid id, NexooDbContext db, CancellationToken ct) =>
        {
            var order = await db.Orders.AsNoTracking()
                .Include(o => o.Business)
                .Include(o => o.Items)
                .FirstOrDefaultAsync(o => o.Id == id, ct);

            return order is null ? Results.NotFound() : Results.Ok(order.ToDto());
        });
    }
}
