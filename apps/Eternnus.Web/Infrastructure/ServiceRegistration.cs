using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using System.Threading.RateLimiting;
namespace Eternnus.Web;

public static class ServiceRegistration
{
    public static void AddEternnusServices(this WebApplicationBuilder builder)
    {
        builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = 65536);
        builder.Services.AddResponseCompression(o =>
        {
            o.EnableForHttps = true;
            // Never compress authentication/CSRF JSON. These MIME types contain only static resources.
            o.MimeTypes = ["text/css", "text/javascript", "application/javascript", "image/svg+xml"];
        });
        if (!builder.Environment.IsDevelopment() && string.IsNullOrWhiteSpace(builder.Configuration.GetConnectionString("Eternnus"))) throw new InvalidOperationException("Configure the production PostgreSQL connection string.");
        var postgres = builder.Configuration.GetConnectionString("Eternnus") ?? "Host=localhost;Port=54329;Database=eternnus;Username=eternnus;Password=local-development-only";
        builder.Services.AddDbContext<GameDb>(o =>
        {
            // SQLite is explicitly test-only. Local development and production both use PostgreSQL.
            if (builder.Environment.IsDevelopment() && builder.Configuration["Database:Provider"] == "SqliteTest")
                o.UseSqlite($"Data Source={builder.Configuration["Database:SqlitePath"]}");
            else o.UseNpgsql(postgres, pg => pg.CommandTimeout(30));
        });
        builder.Services.AddIdentityCore<AppUser>(o =>
        {
            o.User.RequireUniqueEmail = true;
            // Comprimento e tipos de caractere ficam em PasswordPolicyValidator (8 a 128, dois tipos distintos).
            o.Password.RequiredLength = PasswordPolicy.MinLength;
            o.Password.RequireDigit = false; o.Password.RequireLowercase = false;
            o.Password.RequireUppercase = false; o.Password.RequireNonAlphanumeric = false;
            o.Lockout.MaxFailedAccessAttempts = 5; o.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
        }).AddEntityFrameworkStores<GameDb>().AddSignInManager().AddDefaultTokenProviders()
          .AddPasswordValidator<PasswordPolicyValidator>();
        builder.Services.Configure<DataProtectionTokenProviderOptions>(o => o.TokenLifespan = TimeSpan.FromHours(1));
        builder.Services.Configure<SecurityStampValidatorOptions>(o =>
        {
            o.ValidationInterval = TimeSpan.Zero;
            o.OnRefreshingPrincipal = context =>
            {
                if (context.CurrentPrincipal?.HasClaim("amr", "mfa") == true && context.NewPrincipal?.Identity is System.Security.Claims.ClaimsIdentity identity)
                    identity.AddClaim(new System.Security.Claims.Claim("amr", "mfa"));
                return Task.CompletedTask;
            };
        });
        var auth = builder.Services.AddAuthentication(IdentityConstants.ApplicationScheme)
            .AddCookie(IdentityConstants.ApplicationScheme, o =>
            {
                o.Cookie.Name = builder.Environment.IsDevelopment() ? "Eternnus.Session" : "__Host-Eternnus.Session";
                o.Cookie.HttpOnly = true; o.Cookie.SameSite = SameSiteMode.Lax;
                o.Cookie.SecurePolicy = builder.Environment.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
                o.ExpireTimeSpan = LoginSession.Window; o.SlidingExpiration = true;
                o.Events.OnValidatePrincipal = LoginSession.ValidateAsync;
                o.Events.OnRedirectToLogin = c => { c.Response.StatusCode = 401; return Task.CompletedTask; };
                o.Events.OnRedirectToAccessDenied = c => { c.Response.StatusCode = 403; return Task.CompletedTask; };
            }).AddCookie(IdentityConstants.ExternalScheme, o =>
            {
                o.Cookie.Name = "Eternnus.External"; o.Cookie.HttpOnly = true; o.ExpireTimeSpan = TimeSpan.FromMinutes(5);
                o.Cookie.SecurePolicy = builder.Environment.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
            });
        // SignInManager clears these schemes when a security stamp is invalidated.
        // Register their handlers even before the product exposes a two-factor flow.
        foreach (var scheme in new[] { IdentityConstants.TwoFactorRememberMeScheme, IdentityConstants.TwoFactorUserIdScheme })
            auth.AddCookie(scheme, o => {
                o.Cookie.HttpOnly = true;
                o.Cookie.SecurePolicy = builder.Environment.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
                o.ExpireTimeSpan = TimeSpan.FromMinutes(5);
            });
        auth.AddExternalProviders(builder.Configuration);
        builder.Services.AddAuthorization(o =>
        {
            o.AddPolicy("Verified", policy => policy.RequireAuthenticatedUser().RequireAssertion(async context =>
            {
                if (context.Resource is not HttpContext http) return false;
                var user = await http.RequestServices.GetRequiredService<UserManager<AppUser>>().GetUserAsync(context.User);
                return user?.EmailConfirmed == true;
            }));
            // Papéis globais lidos do banco a cada requisição (alteração de papel vale na hora). Também exigem e-mail verificado.
            o.AddPolicy(PlatformAccess.StaffPolicy, policy => policy.RequireAuthenticatedUser().RequireAssertion(async context =>
                context.Resource is HttpContext http && await PlatformAccess.IsStaffAsync(http.RequestServices.GetRequiredService<GameDb>(), PlatformAccess.UserId(context.User), http.RequestAborted)));
            o.AddPolicy(PlatformAccess.AdminPolicy, policy => policy.RequireAuthenticatedUser().RequireAssertion(async context =>
                context.Resource is HttpContext http && await PlatformAccess.IsAdminAsync(http.RequestServices.GetRequiredService<GameDb>(), PlatformAccess.UserId(context.User), http.RequestAborted)));
        });
        builder.Services.AddAntiforgery(o =>
        {
            o.HeaderName = "X-CSRF-TOKEN"; o.Cookie.HttpOnly = true; o.Cookie.SameSite = SameSiteMode.Strict;
            o.Cookie.SecurePolicy = builder.Environment.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
        });
        var keyDirectory = builder.Configuration["DataProtection:Directory"] ?? Path.Combine(builder.Environment.ContentRootPath, "App_Data", "keys");
        Directory.CreateDirectory(keyDirectory);
        var dataProtection = builder.Services.AddDataProtection().SetApplicationName("EternnusRPG").PersistKeysToFileSystem(new DirectoryInfo(keyDirectory));
        // Escopo de máquina: o DPAPI de usuário exige perfil carregado, o que pools compartilhados do IIS
        // (SmarterASP) não oferecem; sem ele, antiforgery, login e OAuth falham com HTTP 500. É o mesmo
        // escopo que o ASP.NET Core adota por padrão no IIS sem perfil. As chaves seguem fora de wwwroot,
        // restritas pela ACL da identidade do site.
        if (OperatingSystem.IsWindows()) dataProtection.ProtectKeysWithDpapi(protectToLocalMachine: true);
        builder.Services.AddScoped<AccountMail>(); builder.Services.AddScoped<ExternalAccounts>(); builder.Services.AddScoped<CampaignService>();
        builder.Services.AddScoped<ProfileService>();
        builder.Services.AddScoped<IAvatarSafety, AvatarSafety>();
        builder.Services.AddHttpClient("avatar-moderation", client => { client.MaxResponseContentBufferSize = 32768; })
            .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false });
        builder.Services.AddScoped<IDocumentScanner, ClamAvDocumentScanner>(); builder.Services.AddScoped<DocumentFiles>(); builder.Services.AddSingleton<RemoteImageFetcher>();
        builder.Services.AddScoped<AuditService>(); builder.Services.AddScoped<AdminService>(); builder.Services.AddScoped<RpgSystemService>();
        builder.Services.AddScoped<SupportService>(); builder.Services.AddScoped<LibraryService>(); builder.Services.AddScoped<SheetTemplateService>();
        builder.Services.AddScoped<GuildService>(); builder.Services.AddScoped<ProgressionService>(); builder.Services.AddScoped<NoticeService>();
        builder.Services.AddScoped<SessionService>(); builder.Services.AddScoped<CharacterSheetService>(); builder.Services.AddSingleton<SessionSignals>(); builder.Services.AddSingleton(TimeProvider.System);
        builder.Services.AddHostedService<MailWorker>();
        builder.Services.AddSingleton<TemporaryImageRelay>();
        builder.Services.AddScoped<CampaignAssetsService>();
        builder.Services.AddScoped<WorkspaceService>();
        builder.Services.AddSingleton(_ => MusicStorage.FromConfiguration(builder.Configuration, builder.Environment)); builder.Services.AddScoped<MusicCatalogService>();
        builder.Services.AddHostedService<MusicStorageSweeper>();
        builder.Services.AddScoped<OneShotLifecycleService>();
        OneShotLifecycleService.Configure(builder.Configuration.GetValue<int?>("OneShots:RecoveryMinutes"));
        builder.Services.AddScoped<PreparationService>(); builder.Services.AddScoped<PlayPreferences>();
        builder.Services.AddHostedService<OneShotWorker>();
        builder.Services.AddHostedService<EmptyTableWorker>();
        builder.Services.AddRateLimiter(o =>
        {
            o.RejectionStatusCode = 429;
            o.AddPolicy("avatar", c => RateLimitPartition.GetFixedWindowLimiter(c.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value ?? c.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => new() { PermitLimit = 3, Window = TimeSpan.FromMinutes(1) }));
            o.AddPolicy("auth", c => RateLimitPartition.GetFixedWindowLimiter(c.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => new() { PermitLimit = 30, Window = TimeSpan.FromMinutes(1) }));
            o.AddPolicy("upload", c => RateLimitPartition.GetFixedWindowLimiter(c.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value ?? c.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => new() { PermitLimit = 10, Window = TimeSpan.FromMinutes(5) }));
            // Envio ao catálogo de músicas (Admin): mais folgado que o "upload" comum para popular o catálogo em lote.
            o.AddPolicy("catalog", c => RateLimitPartition.GetFixedWindowLimiter(c.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value ?? c.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => new() { PermitLimit = 30, Window = TimeSpan.FromMinutes(5) }));
            o.AddPolicy("social", c => RateLimitPartition.GetFixedWindowLimiter(c.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value ?? c.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => new() { PermitLimit = 12, Window = TimeSpan.FromMinutes(1) }));
            o.AddPolicy("mail", c => RateLimitPartition.GetFixedWindowLimiter(c.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => new() { PermitLimit = 6, Window = TimeSpan.FromMinutes(1) }));
            // A consulta ao vivo é uma espera longa somente leitura: balde próprio no limitador global e concorrência por usuário na rota.
            o.AddPolicy("live", c => RateLimitPartition.GetConcurrencyLimiter(c.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value ?? c.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => new() { PermitLimit = 4, QueueLimit = 0 }));
            o.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(c => c.Request.Path.Value?.EndsWith("/live") == true && HttpMethods.IsGet(c.Request.Method) ? RateLimitPartition.GetTokenBucketLimiter("live:" + (c.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value ?? c.Connection.RemoteIpAddress?.ToString() ?? "unknown"), _ => new() { TokenLimit = 180, TokensPerPeriod = 180, ReplenishmentPeriod = TimeSpan.FromMinutes(1), AutoReplenishment = true }) : RateLimitPartition.GetTokenBucketLimiter(c.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value ?? c.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => new() { TokenLimit = 120, TokensPerPeriod = 60, ReplenishmentPeriod = TimeSpan.FromMinutes(1), AutoReplenishment = true }));
        });
    }
}
