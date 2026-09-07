using Microsoft.EntityFrameworkCore;
using Nexoo.Api.Models;

namespace Nexoo.Api.Data;

public class NexooDbContext(DbContextOptions<NexooDbContext> options) : DbContext(options)
{
    public DbSet<Business> Businesses => Set<Business>();
    public DbSet<Product> Products => Set<Product>();
    public DbSet<Order> Orders => Set<Order>();
    public DbSet<OrderItem> OrderItems => Set<OrderItem>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Business>(e =>
        {
            e.ToTable("businesses");
            e.Property(x => x.Name).HasMaxLength(160).IsRequired();
            e.Property(x => x.Description).HasMaxLength(2000);
            e.Property(x => x.Province).HasConversion<string>().HasMaxLength(40).IsRequired();
            e.Property(x => x.Municipality).HasMaxLength(120).IsRequired();
            e.Property(x => x.ContactPhone).HasMaxLength(40);
            e.HasIndex(x => x.Province);
        });

        b.Entity<Product>(e =>
        {
            e.ToTable("products");
            e.Property(x => x.Name).HasMaxLength(160).IsRequired();
            e.Property(x => x.Description).HasMaxLength(2000);
            e.Property(x => x.PriceUsd).HasColumnType("numeric(10,2)");
            e.Property(x => x.PhotoUrl).HasMaxLength(1000);
            e.HasOne(x => x.Business)
             .WithMany(x => x.Products)
             .HasForeignKey(x => x.BusinessId)
             .OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(x => x.BusinessId);
        });

        b.Entity<Order>(e =>
        {
            e.ToTable("orders");
            e.Property(x => x.BuyerName).HasMaxLength(160).IsRequired();
            e.Property(x => x.BuyerEmail).HasMaxLength(200).IsRequired();
            e.Property(x => x.BuyerPhone).HasMaxLength(40).IsRequired();
            e.Property(x => x.RecipientName).HasMaxLength(160).IsRequired();
            e.Property(x => x.RecipientPhone).HasMaxLength(40).IsRequired();
            e.Property(x => x.RecipientProvince).HasConversion<string>().HasMaxLength(40).IsRequired();
            e.Property(x => x.RecipientMunicipality).HasMaxLength(120).IsRequired();
            e.Property(x => x.RecipientAddress).HasMaxLength(500).IsRequired();
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(40).IsRequired();
            e.Property(x => x.TotalUsd).HasColumnType("numeric(10,2)");
            e.Property(x => x.Notes).HasMaxLength(1000);
            e.HasOne(x => x.Business)
             .WithMany()
             .HasForeignKey(x => x.BusinessId)
             .OnDelete(DeleteBehavior.Restrict);
            e.HasIndex(x => x.Status);
            e.HasIndex(x => x.CreatedAt);
        });

        b.Entity<OrderItem>(e =>
        {
            e.ToTable("order_items");
            e.Property(x => x.ProductName).HasMaxLength(160).IsRequired();
            e.Property(x => x.UnitPrice).HasColumnType("numeric(10,2)");
            e.HasOne(x => x.Order)
             .WithMany(x => x.Items)
             .HasForeignKey(x => x.OrderId)
             .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Product)
             .WithMany()
             .HasForeignKey(x => x.ProductId)
             .OnDelete(DeleteBehavior.Restrict);
            e.HasIndex(x => x.OrderId);
        });

        // PostgreSQL convention: snake_case columns, so the schema reads the same
        // from EF, from Supabase's SQL editor and from the checked-in schema script.
        foreach (var entity in b.Model.GetEntityTypes())
        {
            foreach (var property in entity.GetProperties())
            {
                property.SetColumnName(ToSnakeCase(property.Name));
            }
        }
    }

    private static string ToSnakeCase(string name)
    {
        var sb = new System.Text.StringBuilder(name.Length + 4);
        for (var i = 0; i < name.Length; i++)
        {
            var c = name[i];
            if (char.IsUpper(c))
            {
                if (i > 0) sb.Append('_');
                sb.Append(char.ToLowerInvariant(c));
            }
            else
            {
                sb.Append(c);
            }
        }
        return sb.ToString();
    }
}
