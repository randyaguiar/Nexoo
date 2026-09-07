using System.Text;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Nexoo.Api.Data;
using Nexoo.Api.Endpoints;
using Nexoo.Api.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<AdminOptions>(builder.Configuration.GetSection(AdminOptions.SectionName));
builder.Services.Configure<SmtpOptions>(builder.Configuration.GetSection(SmtpOptions.SectionName));

var connectionString = DatabaseConnectionString.Resolve(builder.Configuration);

builder.Services.AddDbContext<NexooDbContext>(options => options.UseNpgsql(connectionString));
builder.Services.AddScoped<IOrderNotifier, SmtpOrderNotifier>();

var adminOptions = builder.Configuration.GetSection(AdminOptions.SectionName).Get<AdminOptions>() ?? new AdminOptions();
if (string.IsNullOrWhiteSpace(adminOptions.Email) || string.IsNullOrWhiteSpace(adminOptions.Password))
{
    throw new InvalidOperationException("Admin:Email and Admin:Password must be configured.");
}

if (adminOptions.JwtSigningKey.Length < 32)
{
    throw new InvalidOperationException("Admin:JwtSigningKey must be at least 32 characters.");
}

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = JwtDefaults.Issuer,
            ValidateAudience = true,
            ValidAudience = JwtDefaults.Audience,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(adminOptions.JwtSigningKey)),
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromMinutes(1)
        };
    });

builder.Services.AddAuthorizationBuilder()
    .AddPolicy(AdminEndpoints.AdminPolicy, policy => policy.RequireRole("admin"));

// CORS_ALLOWED_ORIGINS is a comma-separated list, so a single env var covers the
// production hosts (Vercel domain + preview domains) without JSON config.
var allowedOrigins = builder.Configuration["CORS_ALLOWED_ORIGINS"]
        ?.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
    ?? builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>()
    ?? ["http://localhost:5173"];

builder.Services.AddCors(options => options.AddDefaultPolicy(policy => policy
    .WithOrigins(allowedOrigins)
    .AllowAnyHeader()
    .AllowAnyMethod()));

// Enums travel as names ("PinarDelRio", "PendingPayment") so the API stays readable
// and the frontend never depends on numeric values.
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<NexooDbContext>();
    // The schema is also checked in as db/schema.sql for Supabase; EnsureCreated is a no-op
    // when the tables already exist. Replace with EF migrations once the schema starts evolving.
    await db.Database.EnsureCreatedAsync();

    if (builder.Configuration.GetValue("SeedSampleData", app.Environment.IsDevelopment()))
    {
        await DataSeeder.SeedAsync(db);
    }
}

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/api/health", () => Results.Ok(new { status = "ok" }));
app.MapCatalogEndpoints();
app.MapOrderEndpoints();
app.MapAdminEndpoints();

app.Run();
