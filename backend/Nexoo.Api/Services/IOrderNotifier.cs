using Nexoo.Api.Models;

namespace Nexoo.Api.Services;

public interface IOrderNotifier
{
    Task NotifyNewOrderAsync(Order order, CancellationToken cancellationToken = default);
}
