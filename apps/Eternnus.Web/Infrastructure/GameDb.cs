using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations;
namespace Eternnus.Web;

public class GameDb(DbContextOptions<GameDb> options) : IdentityDbContext<AppUser>(options)
{
    public DbSet<AvatarImage> Avatars => Set<AvatarImage>();
    public DbSet<Character> Characters => Set<Character>();
    public DbSet<CharacterVersion> Versions => Set<CharacterVersion>();
    public DbSet<Campaign> Campaigns => Set<Campaign>();
    public DbSet<Member> Members => Set<Member>();
    public DbSet<OneShotParticipation> OneShotParticipations => Set<OneShotParticipation>();
    public DbSet<GameSession> Sessions => Set<GameSession>();
    public DbSet<MasterResource> Resources => Set<MasterResource>();
    public DbSet<TableEvent> Events => Set<TableEvent>();
    public DbSet<CampaignCharacter> CampaignCharacters => Set<CampaignCharacter>();
    public DbSet<MailDelivery> MailDeliveries => Set<MailDelivery>();
    public DbSet<SessionParticipant> SessionParticipants => Set<SessionParticipant>();
    public DbSet<SessionToken> SessionTokens => Set<SessionToken>();
    public DbSet<RpgSystem> RpgSystems => Set<RpgSystem>();
    public DbSet<AuditEntry> Audit => Set<AuditEntry>();
    public DbSet<SupportTicket> Tickets => Set<SupportTicket>();
    public DbSet<TicketMessage> TicketMessages => Set<TicketMessage>();
    public DbSet<StoredFile> Files => Set<StoredFile>();
    public DbSet<LibraryItem> Library => Set<LibraryItem>();
    public DbSet<SheetTemplate> SheetTemplates => Set<SheetTemplate>();
    public DbSet<SheetTemplateVersion> SheetTemplateVersions => Set<SheetTemplateVersion>();
    public DbSet<CharacterFieldChange> FieldChanges => Set<CharacterFieldChange>();
    public DbSet<GuildCategory> GuildCategories => Set<GuildCategory>();
    public DbSet<GuildTopic> GuildTopics => Set<GuildTopic>();
    public DbSet<GuildPost> GuildPosts => Set<GuildPost>();
    public DbSet<GuildReaction> GuildReactions => Set<GuildReaction>();
    public DbSet<GuildReport> GuildReports => Set<GuildReport>();
    public DbSet<XpEntry> XpEntries => Set<XpEntry>();
    public DbSet<UserAchievement> Achievements => Set<UserAchievement>();
    public DbSet<Scene> Scenes => Set<Scene>();
    public DbSet<MasterCharacter> MasterCharacters => Set<MasterCharacter>();
    public DbSet<RollRequest> RollRequests => Set<RollRequest>();
    public DbSet<CampaignAttendance> Attendance => Set<CampaignAttendance>();
    public DbSet<MusicTrack> MusicTracks => Set<MusicTrack>();
    protected override void OnModelCreating(ModelBuilder b)
    {
        base.OnModelCreating(b);
        b.Entity<AvatarImage>().HasKey(a => a.UserId);
        b.Entity<AvatarImage>().HasOne<AppUser>().WithOne().HasForeignKey<AvatarImage>(a => a.UserId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<AppUser>().HasIndex(x => x.NormalizedEmail).IsUnique();
        b.Entity<Campaign>().Property(x => x.Revision).IsConcurrencyToken();
        b.Entity<Campaign>().HasIndex(x => new { x.OwnerId, x.LastActivityAt });
        b.Entity<Campaign>().HasOne<AppUser>().WithMany().HasForeignKey(x => x.OwnerId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Character>().HasOne<AppUser>().WithMany().HasForeignKey(x => x.OwnerId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Member>().HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<TableEvent>().HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Member>().HasIndex(x => x.UserId);
        b.Entity<Member>().HasOne<Campaign>().WithMany().HasForeignKey(x => x.CampaignId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<CampaignCharacter>().HasOne<Campaign>().WithMany().HasForeignKey(x => x.CampaignId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<CampaignCharacter>().HasOne<Character>().WithMany().HasForeignKey(x => x.CharacterId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<GameSession>().HasOne<Campaign>().WithMany().HasForeignKey(x => x.CampaignId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<MasterResource>().HasOne<Campaign>().WithMany().HasForeignKey(x => x.CampaignId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<TableEvent>().HasOne<Campaign>().WithMany().HasForeignKey(x => x.CampaignId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<CharacterVersion>().HasOne<Character>().WithMany().HasForeignKey(x => x.CharacterId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<MailDelivery>().HasIndex(x => new { x.SentAt, x.AvailableAt });
        b.Entity<Member>().HasKey(x => new { x.CampaignId, x.UserId });
        b.Entity<OneShotParticipation>().HasKey(x => new { x.UserId, x.CampaignId });
        b.Entity<OneShotParticipation>().HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<Campaign>().HasIndex(x => new { x.IsOneShot, x.ExpiresAt });
        b.Entity<CampaignCharacter>().HasKey(x => new { x.CampaignId, x.CharacterId });
        b.Entity<Character>().Property(x => x.Revision).IsConcurrencyToken();
        b.Entity<Campaign>().HasIndex(x => x.InviteCode).IsUnique();
        b.Entity<CharacterVersion>().HasIndex(x => new { x.CharacterId, x.Revision }).IsUnique();
        b.Entity<TableEvent>().HasIndex(x => new { x.CampaignId, x.Id });
        b.Entity<TableEvent>().HasIndex(x => new { x.SessionId, x.Id });
        b.Entity<TableEvent>().HasOne<GameSession>().WithMany().HasForeignKey(x => x.SessionId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<Character>().OwnsMany(x => x.Actions, a => a.ToJson());
        b.Entity<GameSession>().Property(x => x.Revision).IsConcurrencyToken();
        b.Entity<GameSession>().HasIndex(x => new { x.CampaignId, x.Number }).IsUnique();
        // Invariante de banco: no máximo uma sessão em andamento por campanha.
        b.Entity<GameSession>().HasIndex(x => x.CampaignId).IsUnique().HasFilter("\"EndedAt\" IS NULL").HasDatabaseName("IX_Sessions_OneActivePerCampaign");
        b.Entity<SessionParticipant>().HasKey(x => new { x.SessionId, x.UserId });
        b.Entity<SessionParticipant>().HasIndex(x => x.UserId);
        b.Entity<SessionParticipant>().HasOne<GameSession>().WithMany().HasForeignKey(x => x.SessionId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<SessionParticipant>().HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<SessionParticipant>().HasOne<Character>().WithMany().HasForeignKey(x => x.CharacterId).OnDelete(DeleteBehavior.SetNull);
        b.Entity<SessionToken>().HasIndex(x => x.SessionId);
        b.Entity<SessionToken>().HasOne<GameSession>().WithMany().HasForeignKey(x => x.SessionId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<SessionToken>().HasOne<Character>().WithMany().HasForeignKey(x => x.CharacterId).OnDelete(DeleteBehavior.Cascade);
        PlatformModel(b);
        CampaignAssetsModel.Configure(b);
        WorkspaceModel.Configure(b);
        ChapterModel.Configure(b);
        PreparationModel.Configure(b);
        MusicModel.Configure(b);
        NoticeModel.Configure(b);
    }

    /// <summary>Plataforma: papéis, sistemas, auditoria, suporte, biblioteca, fichas-modelo, Guilda e progressão.</summary>
    static void PlatformModel(ModelBuilder b)
    {
        b.Entity<AppUser>().HasIndex(x => x.Role);
        b.Entity<AppUser>().HasIndex(x => x.CreatedAt);
        b.Entity<AppUser>().HasIndex(x => x.Xp);

        b.Entity<RpgSystem>().HasIndex(x => x.Slug).IsUnique();
        b.Entity<RpgSystem>().HasIndex(x => x.Name).IsUnique();
        b.Entity<RpgSystem>().Property(x => x.Revision).IsConcurrencyToken();
        var seeded = new DateTime(2026, 11, 7, 0, 0, 0, DateTimeKind.Utc);
        b.Entity<RpgSystem>().HasData(new RpgSystem { Id = RpgSystem.FreeSystemId, Name = "Sistema livre", Slug = "sistema-livre", Description = "Regras definidas pelo mestre. Usa a ficha clássica de atributos.", Active = true, CreatedAt = seeded, UpdatedAt = seeded });
        b.Entity<Campaign>().HasOne<RpgSystem>().WithMany().HasForeignKey(x => x.RpgSystemId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Campaign>().HasOne<SheetTemplate>().WithMany().HasForeignKey(x => x.SheetTemplateId).OnDelete(DeleteBehavior.SetNull);
        b.Entity<Campaign>().HasIndex(x => x.RpgSystemId);

        b.Entity<AuditEntry>().HasIndex(x => x.CreatedAt);
        b.Entity<AuditEntry>().HasIndex(x => new { x.TargetType, x.TargetId });
        b.Entity<AuditEntry>().HasIndex(x => new { x.ActorId, x.CreatedAt });

        b.Entity<SupportTicket>().HasIndex(x => x.Number).IsUnique();
        b.Entity<SupportTicket>().HasIndex(x => new { x.AuthorId, x.UpdatedAt });
        b.Entity<SupportTicket>().HasIndex(x => new { x.Status, x.UpdatedAt });
        b.Entity<SupportTicket>().Property(x => x.Revision).IsConcurrencyToken();
        b.Entity<SupportTicket>().HasOne<AppUser>().WithMany().HasForeignKey(x => x.AuthorId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<SupportTicket>().HasOne<AppUser>().WithMany().HasForeignKey(x => x.AssignedToId).OnDelete(DeleteBehavior.SetNull);
        b.Entity<TicketMessage>().HasIndex(x => new { x.TicketId, x.Id });
        b.Entity<TicketMessage>().HasOne<SupportTicket>().WithMany().HasForeignKey(x => x.TicketId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<TicketMessage>().HasOne<AppUser>().WithMany().HasForeignKey(x => x.AuthorId).OnDelete(DeleteBehavior.Restrict);

        b.Entity<StoredFile>().HasIndex(x => x.Sha256);
        b.Entity<LibraryItem>().HasIndex(x => new { x.DeletedAt, x.RpgSystemId, x.UpdatedAt });
        b.Entity<LibraryItem>().Property(x => x.Revision).IsConcurrencyToken();
        b.Entity<LibraryItem>().HasOne<StoredFile>().WithMany().HasForeignKey(x => x.FileId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<LibraryItem>().HasOne<RpgSystem>().WithMany().HasForeignKey(x => x.RpgSystemId).OnDelete(DeleteBehavior.Restrict);

        // Catálogo: nome único por sistema; modelos privados: nome único por campanha.
        b.Entity<SheetTemplate>().HasIndex(x => new { x.RpgSystemId, x.Name }).IsUnique().HasFilter("\"CampaignId\" IS NULL");
        b.Entity<SheetTemplate>().HasIndex(x => new { x.CampaignId, x.Name }).IsUnique().HasFilter("\"CampaignId\" IS NOT NULL").HasDatabaseName("IX_SheetTemplates_CampaignId_Name");
        b.Entity<SheetTemplate>().Property(x => x.Revision).IsConcurrencyToken();
        b.Entity<SheetTemplate>().HasOne<RpgSystem>().WithMany().HasForeignKey(x => x.RpgSystemId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<SheetTemplateVersion>().HasIndex(x => new { x.TemplateId, x.Number }).IsUnique();
        b.Entity<SheetTemplateVersion>().Property(x => x.Revision).IsConcurrencyToken();
        b.Entity<SheetTemplateVersion>().HasOne<SheetTemplate>().WithMany().HasForeignKey(x => x.TemplateId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<SheetTemplateVersion>().HasOne<StoredFile>().WithMany().HasForeignKey(x => x.PdfFileId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<SheetTemplateVersion>().OwnsMany(x => x.Pages, o => o.ToJson());
        b.Entity<SheetTemplateVersion>().OwnsMany(x => x.Fields, o => o.ToJson());
        b.Entity<SheetTemplateVersion>().OwnsMany(x => x.Actions, o => o.ToJson());
        b.Entity<Character>().HasOne<SheetTemplateVersion>().WithMany().HasForeignKey(x => x.TemplateVersionId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<CharacterFieldChange>().HasIndex(x => new { x.CharacterId, x.Field, x.Id });
        b.Entity<CharacterFieldChange>().HasIndex(x => new { x.CharacterId, x.Id });
        b.Entity<CharacterFieldChange>().HasOne<Character>().WithMany().HasForeignKey(x => x.CharacterId).OnDelete(DeleteBehavior.Cascade);

        b.Entity<GuildCategory>().HasIndex(x => x.Slug).IsUnique();
        b.Entity<GuildCategory>().HasData(
            new GuildCategory { Id = Guid.Parse("00000000-0000-4000-8000-000000000201"), Name = "Avisos da Guilda", Slug = "avisos", Description = "Novidades e comunicados da equipe Eternnus.", Order = 0, StaffOnly = true },
            new GuildCategory { Id = Guid.Parse("00000000-0000-4000-8000-000000000202"), Name = "Taverna", Slug = "taverna", Description = "Conversa geral entre aventureiros.", Order = 1 },
            new GuildCategory { Id = Guid.Parse("00000000-0000-4000-8000-000000000203"), Name = "Procura-se grupo", Slug = "procura-se-grupo", Description = "Encontre mesa, mestre ou jogadores.", Order = 2 },
            new GuildCategory { Id = Guid.Parse("00000000-0000-4000-8000-000000000204"), Name = "Regras e sistemas", Slug = "regras-e-sistemas", Description = "Dúvidas e debates sobre regras de cada sistema.", Order = 3, MinLevelToPost = 2 },
            new GuildCategory { Id = Guid.Parse("00000000-0000-4000-8000-000000000205"), Name = "Mestres e campanhas", Slug = "mestres-e-campanhas", Description = "Ideias, ganchos e relatos de campanha.", Order = 4, MinLevelToPost = 2 },
            new GuildCategory { Id = Guid.Parse("00000000-0000-4000-8000-000000000206"), Name = "Fichas e biblioteca", Slug = "fichas-e-biblioteca", Description = "Sugestões para fichas-modelo e materiais da biblioteca.", Order = 5 },
            new GuildCategory { Id = Guid.Parse("00000000-0000-4000-8000-000000000207"), Name = "Forja de Ideias", Slug = "forja-de-ideias", Description = "Sugestões de melhorias e novos recursos para a plataforma.", Order = 6 },
            new GuildCategory { Id = Guid.Parse("00000000-0000-4000-8000-000000000208"), Name = "Galeria do Artífice", Slug = "galeria-do-artifice", Description = "Mapas, retratos, tokens e artes criadas pela comunidade.", Order = 7 },
            new GuildCategory { Id = Guid.Parse("00000000-0000-4000-8000-000000000209"), Name = "Portal do Aprendiz", Slug = "portal-do-aprendiz", Description = "Dúvidas de quem está começando no RPG ou na Eternnus.", Order = 8 });
        b.Entity<GuildTopic>().HasIndex(x => new { x.CategoryId, x.DeletedAt, x.Pinned, x.LastPostAt });
        b.Entity<GuildTopic>().HasIndex(x => new { x.AuthorId, x.CreatedAt });
        b.Entity<GuildTopic>().Property(x => x.Revision).IsConcurrencyToken();
        b.Entity<GuildTopic>().HasOne<GuildCategory>().WithMany().HasForeignKey(x => x.CategoryId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<GuildTopic>().HasOne<AppUser>().WithMany().HasForeignKey(x => x.AuthorId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<GuildTopic>().HasOne<RpgSystem>().WithMany().HasForeignKey(x => x.RpgSystemId).OnDelete(DeleteBehavior.SetNull);
        b.Entity<GuildPost>().HasIndex(x => new { x.TopicId, x.Id });
        b.Entity<GuildPost>().HasIndex(x => new { x.AuthorId, x.CreatedAt });
        b.Entity<GuildPost>().HasOne<GuildTopic>().WithMany().HasForeignKey(x => x.TopicId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<GuildPost>().HasOne<AppUser>().WithMany().HasForeignKey(x => x.AuthorId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<GuildReaction>().HasKey(x => new { x.PostId, x.UserId });
        b.Entity<GuildReaction>().HasOne<GuildPost>().WithMany().HasForeignKey(x => x.PostId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<GuildReaction>().HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<GuildReport>().HasIndex(x => new { x.ResolvedAt, x.CreatedAt });
        b.Entity<GuildReport>().HasIndex(x => new { x.PostId, x.ReporterId }).IsUnique();
        b.Entity<GuildReport>().HasOne<GuildPost>().WithMany().HasForeignKey(x => x.PostId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<GuildReport>().HasOne<AppUser>().WithMany().HasForeignKey(x => x.ReporterId).OnDelete(DeleteBehavior.Cascade);

        b.Entity<XpEntry>().HasIndex(x => x.SourceKey).IsUnique();
        b.Entity<XpEntry>().HasIndex(x => new { x.UserId, x.CreatedAt });
        b.Entity<XpEntry>().HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<UserAchievement>().HasKey(x => new { x.UserId, x.Key });
        b.Entity<UserAchievement>().HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}
