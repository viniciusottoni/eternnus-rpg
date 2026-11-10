using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Eternnus.Web.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class StoryChapters : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "ChapterId",
                table: "Sessions",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "ChapterId",
                table: "PastSession",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "StoryChapter",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CampaignId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Title = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    Summary = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    Order = table.Column<int>(type: "integer", nullable: false),
                    Revision = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StoryChapter", x => x.Id);
                    table.ForeignKey(
                        name: "FK_StoryChapter_Campaigns_CampaignId",
                        column: x => x.CampaignId,
                        principalTable: "Campaigns",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Sessions_ChapterId",
                table: "Sessions",
                column: "ChapterId");

            migrationBuilder.CreateIndex(
                name: "IX_PastSession_ChapterId",
                table: "PastSession",
                column: "ChapterId");

            migrationBuilder.CreateIndex(
                name: "IX_StoryChapter_CampaignId_Order",
                table: "StoryChapter",
                columns: new[] { "CampaignId", "Order" });

            migrationBuilder.AddForeignKey(
                name: "FK_PastSession_StoryChapter_ChapterId",
                table: "PastSession",
                column: "ChapterId",
                principalTable: "StoryChapter",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_Sessions_StoryChapter_ChapterId",
                table: "Sessions",
                column: "ChapterId",
                principalTable: "StoryChapter",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_PastSession_StoryChapter_ChapterId",
                table: "PastSession");

            migrationBuilder.DropForeignKey(
                name: "FK_Sessions_StoryChapter_ChapterId",
                table: "Sessions");

            migrationBuilder.DropTable(
                name: "StoryChapter");

            migrationBuilder.DropIndex(
                name: "IX_Sessions_ChapterId",
                table: "Sessions");

            migrationBuilder.DropIndex(
                name: "IX_PastSession_ChapterId",
                table: "PastSession");

            migrationBuilder.DropColumn(
                name: "ChapterId",
                table: "Sessions");

            migrationBuilder.DropColumn(
                name: "ChapterId",
                table: "PastSession");
        }
    }
}
