using Microsoft.EntityFrameworkCore;
using Nexoo.Api.Data;
using Nexoo.Api.Dtos;
using Nexoo.Api.Models;
using Nexoo.Api.Services;

namespace Nexoo.Api.Endpoints;

public static class CatalogEndpoints
{
    public static void MapCatalogEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/catalog").WithTags("Catalog");

        group.MapGet("/businesses", async (Province? province, NexooDbContext db, CancellationToken ct) =>
        {
            var query = db.Businesses.AsNoTracking().Where(b => b.Active);
            if (province is not null)
            {
                query = query.Where(b => b.Province == province);
            }

            var businesses = await query
                .OrderBy(b => b.Name)
                .Select(b => new BusinessDto(
                    b.Id, b.Name, b.Description, b.Province, b.Municipality, b.ContactPhone, b.Active,
                    b.Products.Count(p => p.Available)))
                .ToListAsync(ct);

            return Results.Ok(businesses);
        });

        group.MapGet("/businesses/{id:guid}", async (Guid id, NexooDbContext db, CancellationToken ct) =>
        {
            var business = await db.Businesses.AsNoTracking()
                .Include(b => b.Products)
                .FirstOrDefaultAsync(b => b.Id == id && b.Active, ct);

            if (business is null)
            {
                return Results.NotFound();
            }

            var products = business.Products
                .Where(p => p.Available)
                .OrderBy(p => p.Name)
                .Select(p => p.ToDto())
                .ToList();

            return Results.Ok(new BusinessDetailDto(business.ToDto(products.Count), products));
        });
    }
}
