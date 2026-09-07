using System.Net;
using System.Net.Mail;
using System.Text;
using Microsoft.Extensions.Options;
using Nexoo.Api.Models;

namespace Nexoo.Api.Services;

/// <summary>
/// Sends the admin a "new order" email. When SMTP is not configured (local dev) the
/// message is logged instead, so the checkout flow never fails because of email.
/// </summary>
public class SmtpOrderNotifier(
    IOptions<SmtpOptions> smtpOptions,
    IOptions<AdminOptions> adminOptions,
    ILogger<SmtpOrderNotifier> logger) : IOrderNotifier
{
    private readonly SmtpOptions _smtp = smtpOptions.Value;
    private readonly AdminOptions _admin = adminOptions.Value;

    public async Task NotifyNewOrderAsync(Order order, CancellationToken cancellationToken = default)
    {
        var to = string.IsNullOrWhiteSpace(_admin.NotificationEmail) ? _admin.Email : _admin.NotificationEmail;
        var subject = $"Nexoo - nuevo pedido {ShortRef(order.Id)} ({order.TotalUsd:0.00} USD)";
        var body = BuildBody(order);

        if (!_smtp.IsConfigured || string.IsNullOrWhiteSpace(to))
        {
            logger.LogInformation("Email notification skipped (SMTP not configured). Subject: {Subject}\n{Body}", subject, body);
            return;
        }

        try
        {
            using var client = new SmtpClient(_smtp.Host!, _smtp.Port)
            {
                EnableSsl = _smtp.UseStartTls,
                Credentials = string.IsNullOrWhiteSpace(_smtp.User)
                    ? null
                    : new NetworkCredential(_smtp.User, _smtp.Password)
            };

            using var message = new MailMessage
            {
                From = new MailAddress(_smtp.FromAddress, _smtp.FromName),
                Subject = subject,
                Body = body
            };
            message.To.Add(to);

            await client.SendMailAsync(message, cancellationToken);
        }
        catch (Exception ex)
        {
            // A failed notification must not invalidate an order that is already persisted.
            logger.LogError(ex, "Failed to send new-order notification for order {OrderId}", order.Id);
        }
    }

    internal static string ShortRef(Guid id) => id.ToString("N")[..8].ToUpperInvariant();

    private static string BuildBody(Order order)
    {
        var sb = new StringBuilder();
        sb.AppendLine($"Pedido: {ShortRef(order.Id)} ({order.Id})");
        sb.AppendLine($"Negocio: {order.Business?.Name} ({order.BusinessId})");
        sb.AppendLine($"Total: {order.TotalUsd:0.00} USD");
        sb.AppendLine($"Estado: {order.Status}");
        sb.AppendLine();
        sb.AppendLine("Comprador (EE.UU.):");
        sb.AppendLine($"  {order.BuyerName} / {order.BuyerEmail} / {order.BuyerPhone}");
        sb.AppendLine();
        sb.AppendLine("Destinatario (Cuba):");
        sb.AppendLine($"  {order.RecipientName} / {order.RecipientPhone}");
        sb.AppendLine($"  {order.RecipientProvince}, {order.RecipientMunicipality}");
        sb.AppendLine($"  {order.RecipientAddress}");
        sb.AppendLine();
        sb.AppendLine("Productos:");
        foreach (var item in order.Items)
        {
            sb.AppendLine($"  {item.Quantity} x {item.ProductName} @ {item.UnitPrice:0.00} USD = {item.Quantity * item.UnitPrice:0.00} USD");
        }

        if (!string.IsNullOrWhiteSpace(order.Notes))
        {
            sb.AppendLine();
            sb.AppendLine($"Notas: {order.Notes}");
        }

        return sb.ToString();
    }
}
