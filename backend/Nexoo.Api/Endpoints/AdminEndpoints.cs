using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using Nexoo.Api.Data;
using Nexoo.Api.Dtos;
using Nexoo.Api.Models;
using Nexoo.Api.Services;

namespace Nexoo.Api.Endpoints;

public static class AdminEndpoints
{
    public const string AdminPolicy = "AdminOnly";

    public static void MapAdminEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/admin/login", (
            AdminLoginInput input,
            IOptions<AdminOptions> options) =>
        {
            if (!input.TryValidate(out var problem))
            {
                return problem;
            }

            var admin = options.Value;
            var emailMatches = string.Equals(admin.Email, input.Email.Trim(), StringComparison.OrdinalIgnoreCase);
            var passwordMatches = CryptographicEquals(admin.Password, input.Password);

            if (!emailMatches || !passwordMatches)
            {
                return Results.Unauthorized();
            }

            var expiresAt = DateTimeOffset.UtcNow.AddHours(admin.TokenLifetimeHours);
            var credentials = new SigningCredentials(
                new SymmetricSecurityKey(Encoding.UTF8.GetBytes(admin.JwtSigningKey)),
                SecurityAlgorithms.HmacSha256);

            var token = new JwtSecurityToken(
                issuer: JwtDefaults.Issuer,
                audience: JwtDefaults.Audience,
                claims: [new Claim(ClaimTypes.Name, admin.Email), new Claim(ClaimTypes.Role, "admin")],
                expires: expiresAt.UtcDateTime,
                signingCredentials: credentials);

            return Results.Ok(new AdminLoginResult(new JwtSecurityTokenHandler().WriteToken(token), expiresAt));
        }).WithTags("Admin");

        var group = app.MapGroup("/api/admin").WithTags("Admin").RequireAuthorization(AdminPolicy);

        group.MapGet("/me", () => Results.Ok(new { authenticated = true }));

        MapBusinesses(group);
        MapProducts(group);
        MapOrders(group);
    }

    private static void MapBusinesses(RouteGroupBuilder group)
    {
        group.MapGet("/businesses", async (NexooDbContext db, CancellationToken ct) =>
            Results.Ok(await db.Businesses.AsNoTracking()
                .OrderBy(b => b.Name)
                .Select(b => new BusinessDto(
                    b.Id, b.Name, b.Description, b.Province, b.Municipality, b.ContactPhone, b.Active,
                    b.Products.Count))
                .ToListAsync(ct)));

        group.MapPost("/businesses", async (BusinessInput input, NexooDbContext db, CancellationToken ct) =>
        {
            if (!input.TryValidate(out var problem))
            {
                return problem;
            }

            var business = new Business();
            Apply(input, business);
            db.Businesses.Add(business);
            await db.SaveChangesAsync(ct);

            return Results.Created($"/api/admin/businesses/{business.Id}", business.ToDto(0));
        });

        group.MapPut("/businesses/{id:guid}", async (Guid id, BusinessInput input, NexooDbContext db, CancellationToken ct) =>
        {
            if (!input.TryValidate(out var problem))
            {
                return problem;
            }

            var business = await db.Businesses.FirstOrDefaultAsync(b => b.Id == id, ct);
            if (business is null)
            {
                return Results.NotFound();
            }

            Apply(input, business);
            await db.SaveChangesAsync(ct);

            return Results.Ok(business.ToDto(await db.Products.CountAsync(p => p.BusinessId == id, ct)));
        });

        group.MapDelete("/businesses/{id:guid}", async (Guid id, NexooDbContext db, CancellationToken ct) =>
        {
            var business = await db.Businesses.FirstOrDefaultAsync(b => b.Id == id, ct);
            if (business is null)
            {
                return Results.NotFound();
            }

            // Orders reference the business, so a business with history is deactivated instead of deleted.
            if (await db.Orders.AnyAsync(o => o.BusinessId == id, ct))
            {
                business.Active = false;
                await db.SaveChangesAsync(ct);
                return Results.Ok(new { deactivated = true });
            }

            db.Businesses.Remove(business);
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });
    }

    private static void MapProducts(RouteGroupBuilder group)
    {
        group.MapGet("/products", async (Guid? businessId, NexooDbContext db, CancellationToken ct) =>
        {
            var query = db.Products.AsNoTracking();
            if (businessId is not null)
            {
                query = query.Where(p => p.BusinessId == businessId);
            }

            return Results.Ok(await query.OrderBy(p => p.Name).Select(p => p.ToDto()).ToListAsync(ct));
        });

        group.MapPost("/products", async (ProductInput input, NexooDbContext db, CancellationToken ct) =>
        {
            if (!input.TryValidate(out var problem))
            {
                return problem;
            }

            if (!await db.Businesses.AnyAsync(b => b.Id == input.BusinessId, ct))
            {
                return Results.BadRequest(new { error = "El negocio no existe." });
            }

            var product = new Product { BusinessId = input.BusinessId };
            Apply(input, product);
            db.Products.Add(product);
            await db.SaveChangesAsync(ct);

            return Results.Created($"/api/admin/products/{product.Id}", product.ToDto());
        });

        group.MapPut("/products/{id:guid}", async (Guid id, ProductInput input, NexooDbContext db, CancellationToken ct) =>
        {
            if (!input.TryValidate(out var problem))
            {
                return problem;
            }

            var product = await db.Products.FirstOrDefaultAsync(p => p.Id == id, ct);
            if (product is null)
            {
                return Results.NotFound();
            }

            if (product.BusinessId != input.BusinessId && !await db.Businesses.AnyAsync(b => b.Id == input.BusinessId, ct))
            {
                return Results.BadRequest(new { error = "El negocio no existe." });
            }

            product.BusinessId = input.BusinessId;
            Apply(input, product);
            await db.SaveChangesAsync(ct);

            return Results.Ok(product.ToDto());
        });

        group.MapDelete("/products/{id:guid}", async (Guid id, NexooDbContext db, CancellationToken ct) =>
        {
            var product = await db.Products.FirstOrDefaultAsync(p => p.Id == id, ct);
            if (product is null)
            {
                return Results.NotFound();
            }

            // Order items reference the product, so sold products are only marked unavailable.
            if (await db.OrderItems.AnyAsync(i => i.ProductId == id, ct))
            {
                product.Available = false;
                await db.SaveChangesAsync(ct);
                return Results.Ok(new { deactivated = true });
            }

            db.Products.Remove(product);
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });
    }

    private static void MapOrders(RouteGroupBuilder group)
    {
        group.MapGet("/orders", async (OrderStatus? status, NexooDbContext db, CancellationToken ct) =>
        {
            var query = db.Orders.AsNoTracking()
                .Include(o => o.Business)
                .Include(o => o.Items)
                .AsQueryable();

            if (status is not null)
            {
                query = query.Where(o => o.Status == status);
            }

            var orders = await query.OrderByDescending(o => o.CreatedAt).ToListAsync(ct);
            return Results.Ok(orders.Select(o => o.ToDto()).ToList());
        });

        group.MapGet("/orders/{id:guid}", async (Guid id, NexooDbContext db, CancellationToken ct) =>
        {
            var order = await db.Orders.AsNoTracking()
                .Include(o => o.Business)
                .Include(o => o.Items)
                .FirstOrDefaultAsync(o => o.Id == id, ct);

            return order is null ? Results.NotFound() : Results.Ok(order.ToDto());
        });

        group.MapPut("/orders/{id:guid}/status", async (
            Guid id, UpdateOrderStatusInput input, NexooDbContext db, CancellationToken ct) =>
        {
            if (!input.TryValidate(out var problem))
            {
                return problem;
            }

            var order = await db.Orders
                .Include(o => o.Business)
                .Include(o => o.Items)
                .FirstOrDefaultAsync(o => o.Id == id, ct);

            if (order is null)
            {
                return Results.NotFound();
            }

            order.Status = input.Status;
            order.UpdatedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(ct);

            return Results.Ok(order.ToDto());
        });
    }

    private static void Apply(BusinessInput input, Business business)
    {
        business.Name = input.Name.Trim();
        business.Description = string.IsNullOrWhiteSpace(input.Description) ? null : input.Description.Trim();
        business.Province = input.Province;
        business.Municipality = input.Municipality.Trim();
        business.ContactPhone = string.IsNullOrWhiteSpace(input.ContactPhone) ? null : input.ContactPhone.Trim();
        business.Active = input.Active;
    }

    private static void Apply(ProductInput input, Product product)
    {
        product.Name = input.Name.Trim();
        product.Description = string.IsNullOrWhiteSpace(input.Description) ? null : input.Description.Trim();
        product.PriceUsd = input.PriceUsd;
        product.PhotoUrl = string.IsNullOrWhiteSpace(input.PhotoUrl) ? null : input.PhotoUrl.Trim();
        product.Available = input.Available;
    }

    private static bool CryptographicEquals(string expected, string actual) =>
        System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(expected), Encoding.UTF8.GetBytes(actual));
}

public static class JwtDefaults
{
    public const string Issuer = "nexoo-api";
    public const string Audience = "nexoo-admin";
}
