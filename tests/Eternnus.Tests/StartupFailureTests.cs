using System.Net.Sockets;
using Eternnus.Web;
namespace Eternnus.Tests;
public sealed class StartupFailureTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 7, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Exception_messages_with_secrets_never_reach_the_record()
    {
        var error = new InvalidOperationException("Host=db;Password=super-secret;Username=prod",
            new SocketException((int)SocketError.TimedOut));
        var text = StartupFailure.Describe(error, Now);
        Assert.DoesNotContain("super-secret", text);
        Assert.DoesNotContain("Host=db", text);
        Assert.Contains("System.InvalidOperationException", text);
        Assert.Contains("System.Net.Sockets.SocketException SocketError=TimedOut", text);
        Assert.Contains("2026-11-07 12:00:00 UTC", text);
    }

    [Fact]
    public void Own_configuration_validation_messages_are_kept_because_they_carry_no_values()
    {
        var text = StartupFailure.Describe(new InvalidOperationException("Configure production SMTP."), Now);
        Assert.Contains("Configure production SMTP.", text);
    }

    [Fact]
    public void Records_are_written_under_private_app_data_and_cleared_after_a_good_start()
    {
        var root = Path.Combine(Path.GetTempPath(), "eternnus-startup-" + Guid.NewGuid());
        try
        {
            StartupFailure.Record(new UnauthorizedAccessException("C:\\private\\keys"), root);
            var file = Path.Combine(root, "App_Data", "logs", StartupFailure.FileName);
            var text = File.ReadAllText(file);
            Assert.Contains("System.UnauthorizedAccessException", text);
            Assert.DoesNotContain("private", text);
            StartupFailure.Clear(root);
            Assert.False(File.Exists(file));
        }
        finally { if (Directory.Exists(root)) Directory.Delete(root, true); }
    }
}
