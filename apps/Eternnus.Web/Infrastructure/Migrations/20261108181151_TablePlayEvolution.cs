using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Eternnus.Web.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class TablePlayEvolution : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_SheetTemplates_RpgSystemId_Name",
                table: "SheetTemplates");

            migrationBuilder.AddColumn<Guid>(
                name: "CampaignId",
                table: "SheetTemplates",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "MasterCharacterId",
                table: "SessionTokens",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ActiveTurnKey",
                table: "Sessions",
                type: "character varying(80)",
                maxLength: 80,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "PausedAt",
                table: "Sessions",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PlayMode",
                table: "Sessions",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Recap",
                table: "Sessions",
                type: "character varying(5000)",
                maxLength: 5000,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<DateTime>(
                name: "RecapPublishedAt",
                table: "Sessions",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "SceneId",
                table: "Sessions",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TurnOrder",
                table: "Sessions",
                type: "character varying(8000)",
                maxLength: 8000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Conditions",
                table: "Characters",
                type: "character varying(300)",
                maxLength: 300,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "Shortcuts",
                table: "Characters",
                type: "character varying(4000)",
                maxLength: 4000,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<DateTime>(
                name: "ArchivedAt",
                table: "Campaigns",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "NextSessionAt",
                table: "Campaigns",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "NextSessionNote",
                table: "Campaigns",
                type: "character varying(200)",
                maxLength: 200,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "Kind",
                table: "CampaignLibraryEntry",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "PendingInvite",
                table: "AspNetUsers",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "Attendance",
                columns: table => new
                {
                    CampaignId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: false),
                    SessionAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Status = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Attendance", x => new { x.CampaignId, x.UserId });
                    table.ForeignKey(
                        name: "FK_Attendance_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_Attendance_Campaigns_CampaignId",
                        column: x => x.CampaignId,
                        principalTable: "Campaigns",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "MasterCharacters",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CampaignId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    Summary = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    Notes = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: false),
                    Side = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    SourceId = table.Column<Guid>(type: "uuid", nullable: true),
                    Revision = table.Column<int>(type: "integer", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Resources = table.Column<string>(type: "jsonb", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MasterCharacters", x => x.Id);
                    table.ForeignKey(
                        name: "FK_MasterCharacters_Campaigns_CampaignId",
                        column: x => x.CampaignId,
                        principalTable: "Campaigns",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "RollRequests",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    SessionId = table.Column<Guid>(type: "uuid", nullable: false),
                    Label = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    Formula = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    Spec = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    Visibility = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    Target = table.Column<int>(type: "integer", nullable: true),
                    Rule = table.Column<string>(type: "character varying(5)", maxLength: 5, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CancelledAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ClosedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Targets = table.Column<string>(type: "jsonb", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RollRequests", x => x.Id);
                    table.ForeignKey(
                        name: "FK_RollRequests_Sessions_SessionId",
                        column: x => x.SessionId,
                        principalTable: "Sessions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Scenes",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CampaignId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    Description = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    Kind = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    MapKind = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    MapKey = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    SharedText = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    PrivateNotes = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: false),
                    VisionMode = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: true),
                    HasSaved = table.Column<bool>(type: "boolean", nullable: false),
                    Order = table.Column<int>(type: "integer", nullable: false),
                    Revision = table.Column<int>(type: "integer", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Prepared = table.Column<string>(type: "jsonb", nullable: true),
                    Saved = table.Column<string>(type: "jsonb", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Scenes", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Scenes_Campaigns_CampaignId",
                        column: x => x.CampaignId,
                        principalTable: "Campaigns",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_SheetTemplates_CampaignId_Name",
                table: "SheetTemplates",
                columns: new[] { "CampaignId", "Name" },
                unique: true,
                filter: "\"CampaignId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_SheetTemplates_RpgSystemId_Name",
                table: "SheetTemplates",
                columns: new[] { "RpgSystemId", "Name" },
                unique: true,
                filter: "\"CampaignId\" IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_SessionTokens_MasterCharacterId",
                table: "SessionTokens",
                column: "MasterCharacterId");

            migrationBuilder.CreateIndex(
                name: "IX_Sessions_SceneId",
                table: "Sessions",
                column: "SceneId");

            migrationBuilder.CreateIndex(
                name: "IX_Campaigns_OwnerId_ArchivedAt",
                table: "Campaigns",
                columns: new[] { "OwnerId", "ArchivedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_Attendance_UserId",
                table: "Attendance",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_MasterCharacters_CampaignId_Name",
                table: "MasterCharacters",
                columns: new[] { "CampaignId", "Name" });

            migrationBuilder.CreateIndex(
                name: "IX_RollRequests_SessionId_CreatedAt",
                table: "RollRequests",
                columns: new[] { "SessionId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_Scenes_CampaignId_Order",
                table: "Scenes",
                columns: new[] { "CampaignId", "Order" });

            migrationBuilder.AddForeignKey(
                name: "FK_Sessions_Scenes_SceneId",
                table: "Sessions",
                column: "SceneId",
                principalTable: "Scenes",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_SessionTokens_MasterCharacters_MasterCharacterId",
                table: "SessionTokens",
                column: "MasterCharacterId",
                principalTable: "MasterCharacters",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Sessions_Scenes_SceneId",
                table: "Sessions");

            migrationBuilder.DropForeignKey(
                name: "FK_SessionTokens_MasterCharacters_MasterCharacterId",
                table: "SessionTokens");

            migrationBuilder.DropTable(
                name: "Attendance");

            migrationBuilder.DropTable(
                name: "MasterCharacters");

            migrationBuilder.DropTable(
                name: "RollRequests");

            migrationBuilder.DropTable(
                name: "Scenes");

            migrationBuilder.DropIndex(
                name: "IX_SheetTemplates_CampaignId_Name",
                table: "SheetTemplates");

            migrationBuilder.DropIndex(
                name: "IX_SheetTemplates_RpgSystemId_Name",
                table: "SheetTemplates");

            migrationBuilder.DropIndex(
                name: "IX_SessionTokens_MasterCharacterId",
                table: "SessionTokens");

            migrationBuilder.DropIndex(
                name: "IX_Sessions_SceneId",
                table: "Sessions");

            migrationBuilder.DropIndex(
                name: "IX_Campaigns_OwnerId_ArchivedAt",
                table: "Campaigns");

            migrationBuilder.DropColumn(
                name: "CampaignId",
                table: "SheetTemplates");

            migrationBuilder.DropColumn(
                name: "MasterCharacterId",
                table: "SessionTokens");

            migrationBuilder.DropColumn(
                name: "ActiveTurnKey",
                table: "Sessions");

            migrationBuilder.DropColumn(
                name: "PausedAt",
                table: "Sessions");

            migrationBuilder.DropColumn(
                name: "PlayMode",
                table: "Sessions");

            migrationBuilder.DropColumn(
                name: "Recap",
                table: "Sessions");

            migrationBuilder.DropColumn(
                name: "RecapPublishedAt",
                table: "Sessions");

            migrationBuilder.DropColumn(
                name: "SceneId",
                table: "Sessions");

            migrationBuilder.DropColumn(
                name: "TurnOrder",
                table: "Sessions");

            migrationBuilder.DropColumn(
                name: "Conditions",
                table: "Characters");

            migrationBuilder.DropColumn(
                name: "Shortcuts",
                table: "Characters");

            migrationBuilder.DropColumn(
                name: "ArchivedAt",
                table: "Campaigns");

            migrationBuilder.DropColumn(
                name: "NextSessionAt",
                table: "Campaigns");

            migrationBuilder.DropColumn(
                name: "NextSessionNote",
                table: "Campaigns");

            migrationBuilder.DropColumn(
                name: "Kind",
                table: "CampaignLibraryEntry");

            migrationBuilder.DropColumn(
                name: "PendingInvite",
                table: "AspNetUsers");

            migrationBuilder.CreateIndex(
                name: "IX_SheetTemplates_RpgSystemId_Name",
                table: "SheetTemplates",
                columns: new[] { "RpgSystemId", "Name" },
                unique: true);
        }
    }
}
