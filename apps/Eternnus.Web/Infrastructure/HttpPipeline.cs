using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

public static class HttpPipeline
{
    public static void ValidateEternnusConfiguration(this WebApplication app)
    {
        if (!Uri.TryCreate(app.Configuration["PublicUrl"], UriKind.Absolute, out var publicUrl) || (publicUrl.Scheme != "https" && !app.Environment.IsDevelopment())) throw new InvalidOperationException("Configure PublicUrl as a trusted HTTPS origin.");
        if (!app.Environment.IsDevelopment() && (app.Configuration["Mail:Mode"] == "Pickup" || string.IsNullOrWhiteSpace(app.Configuration["Smtp:Host"]))) throw new InvalidOperationException("Configure production SMTP.");
        // Antiforgery, cookies de login e OAuth dependem da proteção de dados. Testar na inicialização
        // deixa a causa no registro sanitizado de StartupFailure, em vez de HTTP 500 em toda escrita.
        var probe = app.Services.GetRequiredService<IDataProtectionProvider>().CreateProtector("Eternnus.Startup.Probe.v1");
        if (probe.Unprotect(probe.Protect("ok")) != "ok") throw new InvalidOperationException("Configure Data Protection key storage.");
        // Diretório privado do acervo de músicas: criado e conferido fora de wwwroot já na inicialização.
        app.Services.GetRequiredService<MusicStorage>();
    }
    public static void UseEternnusPipeline(this WebApplication app)
    {
        if (!app.Environment.IsDevelopment()) { app.UseHsts(); app.UseHttpsRedirection(); }
        app.Use(async (context, next) =>
        {
            context.Response.Headers["X-Content-Type-Options"] = "nosniff"; context.Response.Headers["X-Frame-Options"] = "DENY";
            context.Response.Headers["Referrer-Policy"] = "no-referrer";
            context.Response.Headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()";
            context.Response.Headers["Content-Security-Policy"] = "default-src 'self'; img-src 'self' https: data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";
            if (context.Request.Path.StartsWithSegments("/api"))
            {
                context.Response.Headers.CacheControl = "no-store";
            }
            else if (context.Request.Query.ContainsKey("flow")) context.Response.Headers.CacheControl = "no-store";
            else if (context.Request.Path == "/") context.Response.Headers.CacheControl = "no-cache";
            // Only the upload routes listed in UploadLimits can exceed the common 64 KiB body cap.
            if (UploadLimits.For(context.Request) is { } uploadLimit)
            {
                var bodyLimit = context.Features.Get<Microsoft.AspNetCore.Http.Features.IHttpMaxRequestBodySizeFeature>();
                if (bodyLimit is { IsReadOnly: false }) bodyLimit.MaxRequestBodySize = uploadLimit;
            }
            try { await next(); }
            catch (RuleException ex) { context.Response.StatusCode = ex.Status; await context.Response.WriteAsJsonAsync(new { message = ex.Message }); }
            catch (DbUpdateConcurrencyException) { context.Response.StatusCode = 409; await context.Response.WriteAsJsonAsync(new { message = "O registro mudou em outra sessão. Atualize e tente novamente." }); }
            catch (BadHttpRequestException ex) when (!context.Response.HasStarted)
            {
                context.Response.StatusCode = ex.StatusCode;
                await context.Response.WriteAsJsonAsync(new { message = ex.StatusCode == 413 ? "O conteúdo enviado excede o limite permitido." : "Solicitação inválida." });
            }
            catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested) { }
            catch (Exception ex)
            {
                app.Logger.LogError(ex, "Request failed: {TraceId}", context.TraceIdentifier);
                if (!context.Response.HasStarted) { context.Response.StatusCode = 500; await context.Response.WriteAsJsonAsync(new { message = "Não foi possível concluir a operação. Tente novamente." }); }
            }
        });
        app.UseResponseCompression(); app.UseDefaultFiles(); app.UseStaticFiles(new StaticFileOptions
        {
            OnPrepareResponse = c =>
            {
                if (c.Context.Request.Query.ContainsKey("flow")) c.Context.Response.Headers.CacheControl = "no-store";
                // Trilha sonora com nome versionado (.vN): trocar o arquivo exige um novo nome, então o cache pode ser imutável.
                else if (c.Context.Request.Path.StartsWithSegments("/assets/audio")) c.Context.Response.Headers.CacheControl = "public,max-age=31536000,immutable";
                else if (c.Context.Request.Path.StartsWithSegments("/assets")) c.Context.Response.Headers.CacheControl = "public,max-age=3600";
                else c.Context.Response.Headers.CacheControl = "no-cache";
            }
        }); app.UseAuthentication(); app.UseRateLimiter();
        app.Use(async (context, next) =>
        {
            if (context.Request.Path.StartsWithSegments("/api"))
            {
                if (!HttpMethods.IsGet(context.Request.Method) && !HttpMethods.IsHead(context.Request.Method))
                {
                    try
                    {
                        if (context.Request.Headers["X-Eternnus"] != "1") throw new AntiforgeryValidationException("Missing application header.");
                        await context.RequestServices.GetRequiredService<IAntiforgery>().ValidateRequestAsync(context);
                    }
                    catch (AntiforgeryValidationException) { context.Response.StatusCode = 400; await context.Response.WriteAsJsonAsync(new { code = "csrf_expired", message = "Sua sessão de formulário expirou. Recarregue a página." }); return; }
                }
            }
            await next();
        });
        app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(20) });
        app.UseAuthorization();
    }
}
