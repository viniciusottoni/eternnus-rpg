using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Eternnus.Web.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class CampaignWorkspace : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ChangedById",
                table: "Versions",
                type: "character varying(450)",
                maxLength: 450,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "SessionId",
                table: "Versions",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "TemporaryImageId",
                table: "Sessions",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TemporaryImageTitle",
                table: "Sessions",
                type: "character varying(120)",
                maxLength: 120,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "VisibleToUserId",
                table: "Events",
                type: "character varying(450)",
                maxLength: 450,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "Private",
                table: "Characters",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTime>(
                name: "ExpiresAt",
                table: "Campaigns",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsOneShot",
                table: "Campaigns",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTime>(
                name: "MasterLastSeenAt",
                table: "Campaigns",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "OneShotParticipations",
                table: "AspNetUsers",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateTable(
                name: "CampaignLibraryEntry",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CampaignId = table.Column<Guid>(type: "uuid", nullable: false),
                    Title = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    Text = table.Column<string>(type: "character varying(10000)", maxLength: 10000, nullable: false),
                    Published = table.Column<bool>(type: "boolean", nullable: false),
                    Revision = table.Column<int>(type: "integer", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CampaignLibraryEntry", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CampaignLibraryEntry_Campaigns_CampaignId",
                        column: x => x.CampaignId,
                        principalTable: "Campaigns",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "CampaignMapFolder",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CampaignId = table.Column<Guid>(type: "uuid", nullable: false),
                    ParentId = table.Column<Guid>(type: "uuid", nullable: true),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CampaignMapFolder", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CampaignMapFolder_CampaignMapFolder_ParentId",
                        column: x => x.ParentId,
                        principalTable: "CampaignMapFolder",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.NoAction);
                    table.ForeignKey(
                        name: "FK_CampaignMapFolder_Campaigns_CampaignId",
                        column: x => x.CampaignId,
                        principalTable: "Campaigns",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "OneShotParticipations",
                columns: table => new
                {
                    UserId = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: false),
                    CampaignId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OneShotParticipations", x => new { x.UserId, x.CampaignId });
                    table.ForeignKey(
                        name: "FK_OneShotParticipations_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "CampaignMap",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CampaignId = table.Column<Guid>(type: "uuid", nullable: false),
                    FolderId = table.Column<Guid>(type: "uuid", nullable: true),
                    Name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    GridPixels = table.Column<int>(type: "integer", nullable: false),
                    ScaleMeters = table.Column<decimal>(type: "numeric(8,2)", precision: 8, scale: 2, nullable: false),
                    Width = table.Column<int>(type: "integer", nullable: false),
                    Height = table.Column<int>(type: "integer", nullable: false),
                    Content = table.Column<byte[]>(type: "bytea", nullable: false),
                    Revision = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CampaignMap", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CampaignMap_CampaignMapFolder_FolderId",
                        column: x => x.FolderId,
                        principalTable: "CampaignMapFolder",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.NoAction);
                    table.ForeignKey(
                        name: "FK_CampaignMap_Campaigns_CampaignId",
                        column: x => x.CampaignId,
                        principalTable: "Campaigns",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            // Preserva o acervo textual anterior na nova aba, sem apagar os recursos legados.
            migrationBuilder.Sql("INSERT INTO \"CampaignLibraryEntry\" (\"Id\", \"CampaignId\", \"Title\", \"Text\", \"Published\", \"Revision\", \"UpdatedAt\") SELECT \"Id\", \"CampaignId\", \"Name\", \"Content\", \"Shared\", 1, CURRENT_TIMESTAMP FROM \"Resources\" WHERE \"Kind\" <> 'mapa';");

            migrationBuilder.CreateIndex(
                name: "IX_Campaigns_IsOneShot_ExpiresAt",
                table: "Campaigns",
                columns: new[] { "IsOneShot", "ExpiresAt" });

            migrationBuilder.CreateIndex(
                name: "IX_CampaignLibraryEntry_CampaignId_Published_UpdatedAt",
                table: "CampaignLibraryEntry",
                columns: new[] { "CampaignId", "Published", "UpdatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_CampaignMap_CampaignId_FolderId",
                table: "CampaignMap",
                columns: new[] { "CampaignId", "FolderId" });

            migrationBuilder.CreateIndex(
                name: "IX_CampaignMap_FolderId",
                table: "CampaignMap",
                column: "FolderId");

            migrationBuilder.CreateIndex(
                name: "IX_CampaignMapFolder_CampaignId_ParentId",
                table: "CampaignMapFolder",
                columns: new[] { "CampaignId", "ParentId" });

            migrationBuilder.CreateIndex(
                name: "IX_CampaignMapFolder_ParentId",
                table: "CampaignMapFolder",
                column: "ParentId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CampaignLibraryEntry");

            migrationBuilder.DropTable(
                name: "CampaignMap");

            migrationBuilder.DropTable(
                name: "OneShotParticipations");

            migrationBuilder.DropTable(
                name: "CampaignMapFolder");

            migrationBuilder.DropIndex(
                name: "IX_Campaigns_IsOneShot_ExpiresAt",
                table: "Campaigns");

            migrationBuilder.DropColumn(
                name: "ChangedById",
                table: "Versions");

            migrationBuilder.DropColumn(
                name: "SessionId",
                table: "Versions");

            migrationBuilder.DropColumn(
                name: "TemporaryImageId",
                table: "Sessions");

            migrationBuilder.DropColumn(
                name: "TemporaryImageTitle",
                table: "Sessions");

            migrationBuilder.DropColumn(
                name: "VisibleToUserId",
                table: "Events");

            migrationBuilder.DropColumn(
                name: "Private",
                table: "Characters");

            migrationBuilder.DropColumn(
                name: "ExpiresAt",
                table: "Campaigns");

            migrationBuilder.DropColumn(
                name: "IsOneShot",
                table: "Campaigns");

            migrationBuilder.DropColumn(
                name: "MasterLastSeenAt",
                table: "Campaigns");

            migrationBuilder.DropColumn(
                name: "OneShotParticipations",
                table: "AspNetUsers");
        }
    }
}
