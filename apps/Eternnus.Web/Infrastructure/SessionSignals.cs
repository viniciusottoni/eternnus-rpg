using System.Collections.Concurrent;
namespace Eternnus.Web;

/// <summary>
/// Sinal em memória para acordar as consultas ao vivo do mesmo processo logo após um commit.
/// Não é fonte de verdade: o banco mantém a revisão e as consultas a reconferem periodicamente,
/// o que mantém o funcionamento (com maior latência) quando houver mais de um processo.
/// </summary>
public sealed class SessionSignals
{
    readonly ConcurrentDictionary<Guid, TaskCompletionSource> waiters = new();

    public Task WaitAsync(Guid session, TimeSpan timeout, CancellationToken ct)
    {
        var signal = waiters.GetOrAdd(session, _ => new(TaskCreationOptions.RunContinuationsAsynchronously));
        return signal.Task.WaitAsync(timeout, ct).ContinueWith(_ => { }, CancellationToken.None, TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
    }

    public void Pulse(Guid session)
    {
        if (waiters.TryRemove(session, out var signal)) signal.TrySetResult();
    }
}
