namespace Nexoo.Api.Models;

/// <summary>
/// MVP scope: only Pinar del Rio and La Habana are supported.
/// Stored as text in PostgreSQL so adding provinces later does not require a data migration.
/// </summary>
public enum Province
{
    PinarDelRio = 1,
    LaHabana = 2
}
