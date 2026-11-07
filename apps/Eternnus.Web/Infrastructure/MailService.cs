using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using MimeKit;
using System.Text;
using System.Text.Json;
namespace Eternnus.Web;

public record MailPayload(string To, string Subject, string Body);

public class AccountMail(GameDb db, UserManager<AppUser> users, IDataProtectionProvider protection, IConfiguration config)
{
    public async Task QueueAsync(AppUser user, bool reset, CancellationToken ct = default)
    {
        var token = reset ? await users.GeneratePasswordResetTokenAsync(user) : await users.GenerateEmailConfirmationTokenAsync(user);
        var code = WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(token));
        var origin = config["PublicUrl"]!.TrimEnd('/');
        var link = $"{origin}/?flow={(reset ? "reset" : "confirm")}&userId={Uri.EscapeDataString(user.Id)}&code={code}";
        var payload = new MailPayload(user.Email!, reset ? "Eternnus — redefina sua senha" : "Eternnus — confirme seu e-mail",
            $"Olá, {user.DisplayName}!\n\n{(reset ? "Para redefinir sua senha" : "Para confirmar seu e-mail e liberar sua aventura")}, acesse:\n{link}\n\nO link expira em uma hora. Se você não fez esta solicitação, ignore esta mensagem.\n\nEternnus RPG");
        db.MailDeliveries.Add(new() { Payload = protection.CreateProtector("Eternnus.AccountMail.v1").Protect(JsonSerializer.Serialize(payload)) });
        await db.SaveChangesAsync(ct);
    }
    public async Task<bool> TryReserveAsync(AppUser user, CancellationToken ct = default)
    {
        var now = DateTime.UtcNow; var cutoff = now.AddMinutes(-1);
        var changed = await db.Users.Where(x => x.Id == user.Id && (x.LastEmailAt == null || x.LastEmailAt < cutoff))
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.LastEmailAt, now), ct);
        return changed == 1;
    }
}

// Durable outbox: a database lease prevents simultaneous workers from sending the same item.
// SMTP delivery is at least once; a crash after acceptance may cause a duplicate message.
public class MailWorker(IServiceScopeFactory scopes, IConfiguration config, IWebHostEnvironment env,
    IDataProtectionProvider protection, ILogger<MailWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = scopes.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<GameDb>();
                var now = DateTime.UtcNow;
                var ids = await db.MailDeliveries.AsNoTracking().Where(x => x.SentAt == null && x.Attempts < 8 && x.AvailableAt <= now && (x.LeaseUntil == null || x.LeaseUntil < now))
                    .OrderBy(x => x.AvailableAt).Select(x => x.Id).Take(10).ToListAsync(stoppingToken);
                foreach (var id in ids)
                {
                    var lease = now.AddMinutes(2);
                    var acquired = await db.MailDeliveries.Where(x => x.Id == id && x.SentAt == null && (x.LeaseUntil == null || x.LeaseUntil < now))
                        .ExecuteUpdateAsync(s => s.SetProperty(x => x.LeaseUntil, lease).SetProperty(x => x.Attempts, x => x.Attempts + 1), stoppingToken);
                    if (acquired == 0) continue;
                    var item = await db.MailDeliveries.SingleAsync(x => x.Id == id, stoppingToken);
                    try
                    {
                        var payload = JsonSerializer.Deserialize<MailPayload>(protection.CreateProtector("Eternnus.AccountMail.v1").Unprotect(item.Payload))!;
                        var message = new MimeMessage();
                        message.From.Add(new MailboxAddress("Eternnus RPG", config["Smtp:From"] ?? "noreply@eternnus.com"));
                        message.To.Add(MailboxAddress.Parse(payload.To)); message.Subject = payload.Subject;
                        message.MessageId = $"{id:N}@eternnus.com"; message.Body = new TextPart("plain") { Text = payload.Body };
                        if (env.IsDevelopment() && config["Mail:Mode"] == "Pickup")
                        {
                            var directory = config["Mail:PickupDirectory"] ?? Path.Combine(env.ContentRootPath, "App_Data", "mail");
                            Directory.CreateDirectory(directory); await message.WriteToAsync(Path.Combine(directory, id + ".eml"), stoppingToken);
                        }
                        else
                        {
                            using var smtp = new SmtpClient(); smtp.Timeout = 30000;
                            await smtp.ConnectAsync(config["Smtp:Host"]!, config.GetValue("Smtp:Port", 587), config.GetValue("Smtp:UseSsl", false) ? SecureSocketOptions.SslOnConnect : SecureSocketOptions.StartTls, stoppingToken);
                            if (!string.IsNullOrWhiteSpace(config["Smtp:Username"])) await smtp.AuthenticateAsync(config["Smtp:Username"]!, config["Smtp:Password"] ?? "", stoppingToken);
                            await smtp.SendAsync(message, stoppingToken); await smtp.DisconnectAsync(true, stoppingToken);
                        }
                        item.SentAt = DateTime.UtcNow; item.Payload = ""; item.LeaseUntil = null;
                    }
                    catch (Exception ex) when (!stoppingToken.IsCancellationRequested)
                    {
                        logger.LogWarning("Email delivery {DeliveryId} failed ({Type}); attempt {Attempt}.", id, ex.GetType().Name, item.Attempts);
                        item.LeaseUntil = null; item.AvailableAt = DateTime.UtcNow.AddSeconds(Math.Min(3600, Math.Pow(2, item.Attempts) * 10));
                    }
                    await db.SaveChangesAsync(stoppingToken);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex) { logger.LogWarning("Mail worker unavailable ({Type}).", ex.GetType().Name); }
            await Task.Delay(TimeSpan.FromSeconds(2), stoppingToken);
        }
    }
}
