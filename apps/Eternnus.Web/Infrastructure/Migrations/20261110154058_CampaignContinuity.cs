using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Eternnus.Web.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class CampaignContinuity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Continuity",
                table: "Campaigns",
                type: "character varying(5000)",
                maxLength: 5000,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "CurrentArc",
                table: "Campaigns",
                type: "character varying(120)",
                maxLength: 120,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<int>(
                name: "FirstSessionNumber",
                table: "Campaigns",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<string>(
                name: "Origin",
                table: "Campaigns",
                type: "character varying(12)",
                maxLength: 12,
                nullable: false,
                defaultValue: "new");

            migrationBuilder.AddColumn<DateOnly>(
                name: "OriginalStartDate",
                table: "Campaigns",
                type: "date",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "PastSession",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CampaignId = table.Column<Guid>(type: "uuid", nullable: false),
                    Number = table.Column<int>(type: "integer", nullable: false),
                    Title = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    Summary = table.Column<string>(type: "character varying(5000)", maxLength: 5000, nullable: false),
                    Date = table.Column<DateOnly>(type: "date", nullable: true),
                    Published = table.Column<bool>(type: "boolean", nullable: false),
                    Revision = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PastSession", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PastSession_Campaigns_CampaignId",
                        column: x => x.CampaignId,
                        principalTable: "Campaigns",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "WorkspacePage",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CampaignId = table.Column<Guid>(type: "uuid", nullable: true),
                    OwnerId = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: false),
                    Kind = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Title = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    Content = table.Column<string>(type: "character varying(10000)", maxLength: 10000, nullable: false),
                    Secrets = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: false),
                    Visibility = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Collection = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    Tags = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    ParentId = table.Column<Guid>(type: "uuid", nullable: true),
                    NpcId = table.Column<Guid>(type: "uuid", nullable: true),
                    MapId = table.Column<Guid>(type: "uuid", nullable: true),
                    Order = table.Column<int>(type: "integer", nullable: false),
                    Revision = table.Column<int>(type: "integer", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    DeletedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WorkspacePage", x => x.Id);
                    table.ForeignKey(
                        name: "FK_WorkspacePage_AspNetUsers_OwnerId",
                        column: x => x.OwnerId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_WorkspacePage_Campaigns_CampaignId",
                        column: x => x.CampaignId,
                        principalTable: "Campaigns",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "WorkspaceReader",
                columns: table => new
                {
                    PageId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WorkspaceReader", x => new { x.PageId, x.UserId });
                    table.ForeignKey(
                        name: "FK_WorkspaceReader_WorkspacePage_PageId",
                        column: x => x.PageId,
                        principalTable: "WorkspacePage",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "WorkspaceVersion",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PageId = table.Column<Guid>(type: "uuid", nullable: false),
                    Number = table.Column<int>(type: "integer", nullable: false),
                    Snapshot = table.Column<string>(type: "character varying(20000)", maxLength: 20000, nullable: false),
                    At = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WorkspaceVersion", x => x.Id);
                    table.ForeignKey(
                        name: "FK_WorkspaceVersion_WorkspacePage_PageId",
                        column: x => x.PageId,
                        principalTable: "WorkspacePage",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_PastSession_CampaignId_Number",
                table: "PastSession",
                columns: new[] { "CampaignId", "Number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_WorkspacePage_CampaignId_Kind_UpdatedAt",
                table: "WorkspacePage",
                columns: new[] { "CampaignId", "Kind", "UpdatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_WorkspacePage_OwnerId_Kind",
                table: "WorkspacePage",
                columns: new[] { "OwnerId", "Kind" });

            migrationBuilder.CreateIndex(
                name: "IX_WorkspaceVersion_PageId_Number",
                table: "WorkspaceVersion",
                columns: new[] { "PageId", "Number" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PastSession");

            migrationBuilder.DropTable(
                name: "WorkspaceReader");

            migrationBuilder.DropTable(
                name: "WorkspaceVersion");

            migrationBuilder.DropTable(
                name: "WorkspacePage");

            migrationBuilder.DropColumn(
                name: "Continuity",
                table: "Campaigns");

            migrationBuilder.DropColumn(
                name: "CurrentArc",
                table: "Campaigns");

            migrationBuilder.DropColumn(
                name: "FirstSessionNumber",
                table: "Campaigns");

            migrationBuilder.DropColumn(
                name: "Origin",
                table: "Campaigns");

            migrationBuilder.DropColumn(
                name: "OriginalStartDate",
                table: "Campaigns");
        }
    }
}
