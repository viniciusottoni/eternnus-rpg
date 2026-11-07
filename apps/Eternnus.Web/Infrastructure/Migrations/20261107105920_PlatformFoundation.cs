using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace Eternnus.Web.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class PlatformFoundation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "TemplateVersionId",
                table: "Characters",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Values",
                table: "Characters",
                type: "character varying(100000)",
                maxLength: 100000,
                nullable: false,
                defaultValue: "{}");

            migrationBuilder.AddColumn<Guid>(
                name: "RpgSystemId",
                table: "Campaigns",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-4000-8000-000000000001"));

            migrationBuilder.AddColumn<Guid>(
                name: "SheetTemplateId",
                table: "Campaigns",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "CreatedAt",
                table: "AspNetUsers",
                type: "timestamp with time zone",
                nullable: false,
                defaultValueSql: "now()");

            migrationBuilder.AddColumn<DateTime>(
                name: "LastSeenAt",
                table: "AspNetUsers",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Level",
                table: "AspNetUsers",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<string>(
                name: "Role",
                table: "AspNetUsers",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "common");

            migrationBuilder.AddColumn<int>(
                name: "Xp",
                table: "AspNetUsers",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateTable(
                name: "Achievements",
                columns: table => new
                {
                    UserId = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: false),
                    Key = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    UnlockedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Achievements", x => new { x.UserId, x.Key });
                    table.ForeignKey(
                        name: "FK_Achievements_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Audit",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ActorId = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: false),
                    Action = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    TargetType = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    TargetId = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    Summary = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    Data = table.Column<string>(type: "character varying(20000)", maxLength: 20000, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Audit", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "FieldChanges",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CharacterId = table.Column<Guid>(type: "uuid", nullable: false),
                    Field = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    OldValue = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    NewValue = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    ChangedById = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: false),
                    SessionId = table.Column<Guid>(type: "uuid", nullable: true),
                    TemplateVersionId = table.Column<Guid>(type: "uuid", nullable: true),
                    Source = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FieldChanges", x => x.Id);
                    table.ForeignKey(
                        name: "FK_FieldChanges_Characters_CharacterId",
                        column: x => x.CharacterId,
                        principalTable: "Characters",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Files",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ContentType = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Size = table.Column<long>(type: "bigint", nullable: false),
                    Sha256 = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Content = table.Column<byte[]>(type: "bytea", nullable: false),
                    UploadedById = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Files", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "GuildCategories",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    Slug = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    Description = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    Order = table.Column<int>(type: "integer", nullable: false),
                    MinLevelToPost = table.Column<int>(type: "integer", nullable: false),
                    StaffOnly = table.Column<bool>(type: "boolean", nullable: false),
                    ArchivedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GuildCategories", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "RpgSystems",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    Slug = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    Description = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    Active = table.Column<bool>(type: "boolean", nullable: false),
                    Revision = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RpgSystems", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Tickets",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Number = table.Column<int>(type: "integer", nullable: false),
                    AuthorId = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: false),
                    Subject = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    Category = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Priority = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    AssignedToId = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ClosedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Revision = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Tickets", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Tickets_AspNetUsers_AssignedToId",
                        column: x => x.AssignedToId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_Tickets_AspNetUsers_AuthorId",
                        column: x => x.AuthorId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "XpEntries",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    UserId = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: false),
                    Reason = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    Amount = table.Column<int>(type: "integer", nullable: false),
                    SourceKey = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_XpEntries", x => x.Id);
                    table.ForeignKey(
                        name: "FK_XpEntries_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "GuildTopics",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CategoryId = table.Column<Guid>(type: "uuid", nullable: false),
                    RpgSystemId = table.Column<Guid>(type: "uuid", nullable: true),
                    AuthorId = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: false),
                    Title = table.Column<string>(type: "character varying(140)", maxLength: 140, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastPostAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    PostCount = table.Column<int>(type: "integer", nullable: false),
                    Pinned = table.Column<bool>(type: "boolean", nullable: false),
                    Locked = table.Column<bool>(type: "boolean", nullable: false),
                    DeletedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Revision = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GuildTopics", x => x.Id);
                    table.ForeignKey(
                        name: "FK_GuildTopics_AspNetUsers_AuthorId",
                        column: x => x.AuthorId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_GuildTopics_GuildCategories_CategoryId",
                        column: x => x.CategoryId,
                        principalTable: "GuildCategories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_GuildTopics_RpgSystems_RpgSystemId",
                        column: x => x.RpgSystemId,
                        principalTable: "RpgSystems",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "Library",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RpgSystemId = table.Column<Guid>(type: "uuid", nullable: true),
                    Title = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    Description = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    Category = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    FileName = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    FileId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedById = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: false),
                    UpdatedById = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    DeletedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Downloads = table.Column<int>(type: "integer", nullable: false),
                    Revision = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Library", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Library_Files_FileId",
                        column: x => x.FileId,
                        principalTable: "Files",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Library_RpgSystems_RpgSystemId",
                        column: x => x.RpgSystemId,
                        principalTable: "RpgSystems",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "SheetTemplates",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RpgSystemId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Description = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    CurrentVersionId = table.Column<Guid>(type: "uuid", nullable: true),
                    IsDefault = table.Column<bool>(type: "boolean", nullable: false),
                    ArchivedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedById = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Revision = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SheetTemplates", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SheetTemplates_RpgSystems_RpgSystemId",
                        column: x => x.RpgSystemId,
                        principalTable: "RpgSystems",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "TicketMessages",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TicketId = table.Column<Guid>(type: "uuid", nullable: false),
                    AuthorId = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: false),
                    Body = table.Column<string>(type: "character varying(5000)", maxLength: 5000, nullable: false),
                    Internal = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TicketMessages", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TicketMessages_AspNetUsers_AuthorId",
                        column: x => x.AuthorId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_TicketMessages_Tickets_TicketId",
                        column: x => x.TicketId,
                        principalTable: "Tickets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "GuildPosts",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TopicId = table.Column<Guid>(type: "uuid", nullable: false),
                    AuthorId = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: false),
                    Body = table.Column<string>(type: "character varying(10000)", maxLength: 10000, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    EditedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    DeletedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    DeletedById = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: true),
                    UsefulCount = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GuildPosts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_GuildPosts_AspNetUsers_AuthorId",
                        column: x => x.AuthorId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_GuildPosts_GuildTopics_TopicId",
                        column: x => x.TopicId,
                        principalTable: "GuildTopics",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "SheetTemplateVersions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TemplateId = table.Column<Guid>(type: "uuid", nullable: false),
                    Number = table.Column<int>(type: "integer", nullable: false),
                    PdfFileId = table.Column<Guid>(type: "uuid", nullable: true),
                    Notes = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    PublishedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    PublishedById = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: true),
                    Revision = table.Column<int>(type: "integer", nullable: false),
                    Actions = table.Column<string>(type: "jsonb", nullable: true),
                    Fields = table.Column<string>(type: "jsonb", nullable: true),
                    Pages = table.Column<string>(type: "jsonb", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SheetTemplateVersions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SheetTemplateVersions_Files_PdfFileId",
                        column: x => x.PdfFileId,
                        principalTable: "Files",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_SheetTemplateVersions_SheetTemplates_TemplateId",
                        column: x => x.TemplateId,
                        principalTable: "SheetTemplates",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "GuildReactions",
                columns: table => new
                {
                    PostId = table.Column<long>(type: "bigint", nullable: false),
                    UserId = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GuildReactions", x => new { x.PostId, x.UserId });
                    table.ForeignKey(
                        name: "FK_GuildReactions_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_GuildReactions_GuildPosts_PostId",
                        column: x => x.PostId,
                        principalTable: "GuildPosts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "GuildReports",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    PostId = table.Column<long>(type: "bigint", nullable: false),
                    ReporterId = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: false),
                    Reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ResolvedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ResolvedById = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: true),
                    Resolution = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GuildReports", x => x.Id);
                    table.ForeignKey(
                        name: "FK_GuildReports_AspNetUsers_ReporterId",
                        column: x => x.ReporterId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_GuildReports_GuildPosts_PostId",
                        column: x => x.PostId,
                        principalTable: "GuildPosts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.InsertData(
                table: "GuildCategories",
                columns: new[] { "Id", "ArchivedAt", "Description", "MinLevelToPost", "Name", "Order", "Slug", "StaffOnly" },
                values: new object[,]
                {
                    { new Guid("00000000-0000-4000-8000-000000000201"), null, "Novidades e comunicados da equipe Eternnus.", 1, "Avisos da Guilda", 0, "avisos", true },
                    { new Guid("00000000-0000-4000-8000-000000000202"), null, "Conversa geral entre aventureiros.", 1, "Taverna", 1, "taverna", false },
                    { new Guid("00000000-0000-4000-8000-000000000203"), null, "Encontre mesa, mestre ou jogadores.", 1, "Procura-se grupo", 2, "procura-se-grupo", false },
                    { new Guid("00000000-0000-4000-8000-000000000204"), null, "Dúvidas e debates sobre regras de cada sistema.", 2, "Regras e sistemas", 3, "regras-e-sistemas", false },
                    { new Guid("00000000-0000-4000-8000-000000000205"), null, "Ideias, ganchos e relatos de campanha.", 2, "Mestres e campanhas", 4, "mestres-e-campanhas", false },
                    { new Guid("00000000-0000-4000-8000-000000000206"), null, "Sugestões para fichas-modelo e materiais da biblioteca.", 1, "Fichas e biblioteca", 5, "fichas-e-biblioteca", false }
                });

            migrationBuilder.InsertData(
                table: "RpgSystems",
                columns: new[] { "Id", "Active", "CreatedAt", "Description", "Name", "Revision", "Slug", "UpdatedAt" },
                values: new object[] { new Guid("00000000-0000-4000-8000-000000000001"), true, new DateTime(2026, 11, 7, 0, 0, 0, 0, DateTimeKind.Utc), "Regras definidas pelo mestre. Usa a ficha clássica de atributos.", "Sistema livre", 1, "sistema-livre", new DateTime(2026, 11, 7, 0, 0, 0, 0, DateTimeKind.Utc) });

            // Campanhas existentes tinham o sistema como texto livre: cada nome distinto vira um sistema
            // (slug estável "legado-<hash>"), preservando o que o mestre escreveu. "Sistema livre" fica no sistema fixo.
            migrationBuilder.Sql("""
                INSERT INTO "RpgSystems" ("Id", "Name", "Slug", "Description", "Active", "Revision", "CreatedAt", "UpdatedAt")
                SELECT gen_random_uuid(), d.name, 'legado-' || substr(md5(lower(d.name)), 1, 10), 'Criado a partir de campanhas existentes.', true, 1, now(), now()
                FROM (SELECT DISTINCT btrim("System") AS name FROM "Campaigns" WHERE btrim("System") <> '' AND lower(btrim("System")) <> 'sistema livre') d
                ON CONFLICT DO NOTHING;
                UPDATE "Campaigns" c SET "RpgSystemId" = s."Id"
                FROM "RpgSystems" s WHERE s."Name" = btrim(c."System") AND s."Id" <> '00000000-0000-4000-8000-000000000001';
                UPDATE "Campaigns" c SET "System" = s."Name" FROM "RpgSystems" s WHERE s."Id" = c."RpgSystemId";
                """);

            migrationBuilder.CreateIndex(
                name: "IX_Characters_TemplateVersionId",
                table: "Characters",
                column: "TemplateVersionId");

            migrationBuilder.CreateIndex(
                name: "IX_Campaigns_RpgSystemId",
                table: "Campaigns",
                column: "RpgSystemId");

            migrationBuilder.CreateIndex(
                name: "IX_Campaigns_SheetTemplateId",
                table: "Campaigns",
                column: "SheetTemplateId");

            migrationBuilder.CreateIndex(
                name: "IX_AspNetUsers_CreatedAt",
                table: "AspNetUsers",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_AspNetUsers_Role",
                table: "AspNetUsers",
                column: "Role");

            migrationBuilder.CreateIndex(
                name: "IX_AspNetUsers_Xp",
                table: "AspNetUsers",
                column: "Xp");

            migrationBuilder.CreateIndex(
                name: "IX_Audit_ActorId_CreatedAt",
                table: "Audit",
                columns: new[] { "ActorId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_Audit_CreatedAt",
                table: "Audit",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_Audit_TargetType_TargetId",
                table: "Audit",
                columns: new[] { "TargetType", "TargetId" });

            migrationBuilder.CreateIndex(
                name: "IX_FieldChanges_CharacterId_Field_Id",
                table: "FieldChanges",
                columns: new[] { "CharacterId", "Field", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_FieldChanges_CharacterId_Id",
                table: "FieldChanges",
                columns: new[] { "CharacterId", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_Files_Sha256",
                table: "Files",
                column: "Sha256");

            migrationBuilder.CreateIndex(
                name: "IX_GuildCategories_Slug",
                table: "GuildCategories",
                column: "Slug",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_GuildPosts_AuthorId_CreatedAt",
                table: "GuildPosts",
                columns: new[] { "AuthorId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_GuildPosts_TopicId_Id",
                table: "GuildPosts",
                columns: new[] { "TopicId", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_GuildReactions_UserId",
                table: "GuildReactions",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_GuildReports_PostId_ReporterId",
                table: "GuildReports",
                columns: new[] { "PostId", "ReporterId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_GuildReports_ReporterId",
                table: "GuildReports",
                column: "ReporterId");

            migrationBuilder.CreateIndex(
                name: "IX_GuildReports_ResolvedAt_CreatedAt",
                table: "GuildReports",
                columns: new[] { "ResolvedAt", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_GuildTopics_AuthorId_CreatedAt",
                table: "GuildTopics",
                columns: new[] { "AuthorId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_GuildTopics_CategoryId_DeletedAt_Pinned_LastPostAt",
                table: "GuildTopics",
                columns: new[] { "CategoryId", "DeletedAt", "Pinned", "LastPostAt" });

            migrationBuilder.CreateIndex(
                name: "IX_GuildTopics_RpgSystemId",
                table: "GuildTopics",
                column: "RpgSystemId");

            migrationBuilder.CreateIndex(
                name: "IX_Library_DeletedAt_RpgSystemId_UpdatedAt",
                table: "Library",
                columns: new[] { "DeletedAt", "RpgSystemId", "UpdatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_Library_FileId",
                table: "Library",
                column: "FileId");

            migrationBuilder.CreateIndex(
                name: "IX_Library_RpgSystemId",
                table: "Library",
                column: "RpgSystemId");

            migrationBuilder.CreateIndex(
                name: "IX_RpgSystems_Name",
                table: "RpgSystems",
                column: "Name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_RpgSystems_Slug",
                table: "RpgSystems",
                column: "Slug",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SheetTemplates_RpgSystemId_Name",
                table: "SheetTemplates",
                columns: new[] { "RpgSystemId", "Name" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SheetTemplateVersions_PdfFileId",
                table: "SheetTemplateVersions",
                column: "PdfFileId");

            migrationBuilder.CreateIndex(
                name: "IX_SheetTemplateVersions_TemplateId_Number",
                table: "SheetTemplateVersions",
                columns: new[] { "TemplateId", "Number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_TicketMessages_AuthorId",
                table: "TicketMessages",
                column: "AuthorId");

            migrationBuilder.CreateIndex(
                name: "IX_TicketMessages_TicketId_Id",
                table: "TicketMessages",
                columns: new[] { "TicketId", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_Tickets_AssignedToId",
                table: "Tickets",
                column: "AssignedToId");

            migrationBuilder.CreateIndex(
                name: "IX_Tickets_AuthorId_UpdatedAt",
                table: "Tickets",
                columns: new[] { "AuthorId", "UpdatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_Tickets_Number",
                table: "Tickets",
                column: "Number",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Tickets_Status_UpdatedAt",
                table: "Tickets",
                columns: new[] { "Status", "UpdatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_XpEntries_SourceKey",
                table: "XpEntries",
                column: "SourceKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_XpEntries_UserId_CreatedAt",
                table: "XpEntries",
                columns: new[] { "UserId", "CreatedAt" });

            migrationBuilder.AddForeignKey(
                name: "FK_Campaigns_RpgSystems_RpgSystemId",
                table: "Campaigns",
                column: "RpgSystemId",
                principalTable: "RpgSystems",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Campaigns_SheetTemplates_SheetTemplateId",
                table: "Campaigns",
                column: "SheetTemplateId",
                principalTable: "SheetTemplates",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_Characters_SheetTemplateVersions_TemplateVersionId",
                table: "Characters",
                column: "TemplateVersionId",
                principalTable: "SheetTemplateVersions",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Campaigns_RpgSystems_RpgSystemId",
                table: "Campaigns");

            migrationBuilder.DropForeignKey(
                name: "FK_Campaigns_SheetTemplates_SheetTemplateId",
                table: "Campaigns");

            migrationBuilder.DropForeignKey(
                name: "FK_Characters_SheetTemplateVersions_TemplateVersionId",
                table: "Characters");

            migrationBuilder.DropTable(
                name: "Achievements");

            migrationBuilder.DropTable(
                name: "Audit");

            migrationBuilder.DropTable(
                name: "FieldChanges");

            migrationBuilder.DropTable(
                name: "GuildReactions");

            migrationBuilder.DropTable(
                name: "GuildReports");

            migrationBuilder.DropTable(
                name: "Library");

            migrationBuilder.DropTable(
                name: "SheetTemplateVersions");

            migrationBuilder.DropTable(
                name: "TicketMessages");

            migrationBuilder.DropTable(
                name: "XpEntries");

            migrationBuilder.DropTable(
                name: "GuildPosts");

            migrationBuilder.DropTable(
                name: "Files");

            migrationBuilder.DropTable(
                name: "SheetTemplates");

            migrationBuilder.DropTable(
                name: "Tickets");

            migrationBuilder.DropTable(
                name: "GuildTopics");

            migrationBuilder.DropTable(
                name: "GuildCategories");

            migrationBuilder.DropTable(
                name: "RpgSystems");

            migrationBuilder.DropIndex(
                name: "IX_Characters_TemplateVersionId",
                table: "Characters");

            migrationBuilder.DropIndex(
                name: "IX_Campaigns_RpgSystemId",
                table: "Campaigns");

            migrationBuilder.DropIndex(
                name: "IX_Campaigns_SheetTemplateId",
                table: "Campaigns");

            migrationBuilder.DropIndex(
                name: "IX_AspNetUsers_CreatedAt",
                table: "AspNetUsers");

            migrationBuilder.DropIndex(
                name: "IX_AspNetUsers_Role",
                table: "AspNetUsers");

            migrationBuilder.DropIndex(
                name: "IX_AspNetUsers_Xp",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "TemplateVersionId",
                table: "Characters");

            migrationBuilder.DropColumn(
                name: "Values",
                table: "Characters");

            migrationBuilder.DropColumn(
                name: "RpgSystemId",
                table: "Campaigns");

            migrationBuilder.DropColumn(
                name: "SheetTemplateId",
                table: "Campaigns");

            migrationBuilder.DropColumn(
                name: "CreatedAt",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "LastSeenAt",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "Level",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "Role",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "Xp",
                table: "AspNetUsers");
        }
    }
}
