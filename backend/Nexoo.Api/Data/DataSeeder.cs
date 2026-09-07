using Microsoft.EntityFrameworkCore;
using Nexoo.Api.Models;

namespace Nexoo.Api.Data;

public static class DataSeeder
{
    /// <summary>Seeds one real test business per launch province, only when the catalog is empty.</summary>
    public static async Task SeedAsync(NexooDbContext db, CancellationToken ct = default)
    {
        if (await db.Businesses.AnyAsync(ct))
        {
            return;
        }

        var dulceria = new Business
        {
            Name = "Dulcería La Vueltabajera",
            Description = "Dulces finos, cakes y merenguitos hechos por encargo en el centro de Pinar del Río.",
            Province = Province.PinarDelRio,
            Municipality = "Pinar del Río",
            ContactPhone = "+53 5 555 1234",
            Products =
            {
                new Product { Name = "Cake de chocolate (8 porciones)", Description = "Cake húmedo de chocolate con cobertura de ganache.", PriceUsd = 22.00m, PhotoUrl = "https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=800" },
                new Product { Name = "Caja de merenguitos (24 u.)", Description = "Merenguitos tradicionales cubanos.", PriceUsd = 9.50m, PhotoUrl = "https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=800" },
                new Product { Name = "Pastelitos de guayaba (12 u.)", Description = "Hojaldre relleno de guayaba.", PriceUsd = 12.00m, PhotoUrl = "https://images.unsplash.com/photo-1509440159596-0249088772ff?w=800" }
            }
        };

        var cafeteria = new Business
        {
            Name = "Cafetería El Malecón",
            Description = "Cafetería habanera: café, batidos y combos para llevar a domicilio.",
            Province = Province.LaHabana,
            Municipality = "Centro Habana",
            ContactPhone = "+53 5 555 9876",
            Products =
            {
                new Product { Name = "Combo desayuno para 2", Description = "Café con leche, tostadas y jugo natural.", PriceUsd = 15.00m, PhotoUrl = "https://images.unsplash.com/photo-1533089860892-a7c6f0a88666?w=800" },
                new Product { Name = "Paquete de café molido (500 g)", Description = "Café cubano molido, tueste medio.", PriceUsd = 11.00m, PhotoUrl = "https://images.unsplash.com/photo-1447933601403-0c6688de566e?w=800" }
            }
        };

        db.Businesses.AddRange(dulceria, cafeteria);
        await db.SaveChangesAsync(ct);
    }
}
