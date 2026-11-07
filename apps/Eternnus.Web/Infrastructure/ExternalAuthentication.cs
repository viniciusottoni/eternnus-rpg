using System.Net.Http.Headers;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.OAuth;
using Microsoft.AspNetCore.Identity;
namespace Eternnus.Web;

public static class ExternalAuthentication
{
    public static void AddExternalProviders(this AuthenticationBuilder auth, IConfiguration config)
    {
        foreach (var provider in new[] { "Google", "Discord" })
        {
            var id = config[$"Authentication:{provider}:ClientId"];
            var secret = config[$"Authentication:{provider}:ClientSecret"];
            if (string.IsNullOrWhiteSpace(id) != string.IsNullOrWhiteSpace(secret))
                throw new InvalidOperationException($"Configure both ClientId and ClientSecret for {provider}.");
        }
        if (!string.IsNullOrWhiteSpace(config["Authentication:Google:ClientId"])) auth.AddGoogle("Google", o =>
        {
            o.ClientId = config["Authentication:Google:ClientId"]!; o.ClientSecret = config["Authentication:Google:ClientSecret"]!;
            o.SignInScheme = IdentityConstants.ExternalScheme; o.UsePkce = true; o.SaveTokens = false;
            o.Events.OnCreatingTicket = context =>
            {
                var root = context.User;
                var verified = (root.TryGetProperty("verified_email", out var v) || root.TryGetProperty("email_verified", out v)) && v.ValueKind == JsonValueKind.True;
                context.Identity!.AddClaim(new("email_verified", verified ? "true" : "false"));
                if (root.TryGetProperty("picture", out var picture)) context.Identity.AddClaim(new("avatar", picture.GetString() ?? ""));
                return Task.CompletedTask;
            };
            o.Events.OnRemoteFailure = Failed;
        });
        if (!string.IsNullOrWhiteSpace(config["Authentication:Discord:ClientId"])) auth.AddOAuth("Discord", o =>
        {
            o.ClientId = config["Authentication:Discord:ClientId"]!; o.ClientSecret = config["Authentication:Discord:ClientSecret"]!;
            o.SignInScheme = IdentityConstants.ExternalScheme; o.CallbackPath = "/signin-discord";
            o.AuthorizationEndpoint = "https://discord.com/oauth2/authorize"; o.TokenEndpoint = "https://discord.com/api/oauth2/token";
            o.UserInformationEndpoint = "https://discord.com/api/users/@me"; o.Scope.Add("identify"); o.Scope.Add("email"); o.SaveTokens = false;
            o.Events.OnCreatingTicket = async context =>
            {
                using var request = new HttpRequestMessage(HttpMethod.Get, context.Options.UserInformationEndpoint);
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", context.AccessToken);
                using var response = await context.Backchannel.SendAsync(request, context.HttpContext.RequestAborted); response.EnsureSuccessStatusCode();
                using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(context.HttpContext.RequestAborted)); var user = document.RootElement;
                var id = user.GetProperty("id").GetString()!;
                context.Identity!.AddClaim(new(ClaimTypes.NameIdentifier, id));
                context.Identity.AddClaim(new(ClaimTypes.Name, user.TryGetProperty("global_name", out var name) && name.ValueKind == JsonValueKind.String ? name.GetString()! : user.GetProperty("username").GetString()!));
                if (user.TryGetProperty("email", out var email) && email.ValueKind == JsonValueKind.String) context.Identity.AddClaim(new(ClaimTypes.Email, email.GetString()!));
                context.Identity.AddClaim(new("email_verified", user.TryGetProperty("verified", out var verified) && verified.ValueKind == JsonValueKind.True ? "true" : "false"));
                if (user.TryGetProperty("avatar", out var avatar) && avatar.ValueKind == JsonValueKind.String) context.Identity.AddClaim(new("avatar", $"https://cdn.discordapp.com/avatars/{id}/{avatar.GetString()}.png"));
            };
            o.Events.OnRemoteFailure = Failed;
        });
    }
    static Task Failed(RemoteFailureContext context) { context.HandleResponse(); context.Response.Redirect("/?authError=external#login"); return Task.CompletedTask; }
}
