using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Eternnus.Web.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class TableFogLighting : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "Dc",
                table: "SessionTokens",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "DetectRange",
                table: "SessionTokens",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DetectSense",
                table: "SessionTokens",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "Hidden",
                table: "SessionTokens",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "Light",
                table: "SessionTokens",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Perception",
                table: "SessionTokens",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<List<string>>(
                name: "RevealedTo",
                table: "SessionTokens",
                type: "text[]",
                nullable: false,
                defaultValueSql: "'{}'::text[]");

            migrationBuilder.AddColumn<string>(
                name: "Senses",
                table: "SessionTokens",
                type: "character varying(400)",
                maxLength: 400,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Vision",
                table: "SessionTokens",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TableSettings",
                table: "Sessions",
                type: "character varying(4000)",
                maxLength: 4000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TableSettings",
                table: "RpgSystems",
                type: "character varying(4000)",
                maxLength: 4000,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "LightMeters",
                table: "Characters",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Perception",
                table: "Characters",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "ReachMeters",
                table: "Characters",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Senses",
                table: "Characters",
                type: "character varying(400)",
                maxLength: 400,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "VisionMeters",
                table: "Characters",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TableSettings",
                table: "Campaigns",
                type: "character varying(4000)",
                maxLength: 4000,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "CampaignMapLayer",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CampaignId = table.Column<Guid>(type: "uuid", nullable: false),
                    MapKey = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    State = table.Column<string>(type: "character varying(400000)", maxLength: 400000, nullable: false),
                    Revision = table.Column<int>(type: "integer", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CampaignMapLayer", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CampaignMapLayer_Campaigns_CampaignId",
                        column: x => x.CampaignId,
                        principalTable: "Campaigns",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.UpdateData(
                table: "RpgSystems",
                keyColumn: "Id",
                keyValue: new Guid("00000000-0000-4000-8000-000000000001"),
                column: "TableSettings",
                value: null);

            migrationBuilder.CreateIndex(
                name: "IX_CampaignMapLayer_CampaignId_MapKey",
                table: "CampaignMapLayer",
                columns: new[] { "CampaignId", "MapKey" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CampaignMapLayer");

            migrationBuilder.DropColumn(
                name: "Dc",
                table: "SessionTokens");

            migrationBuilder.DropColumn(
                name: "DetectRange",
                table: "SessionTokens");

            migrationBuilder.DropColumn(
                name: "DetectSense",
                table: "SessionTokens");

            migrationBuilder.DropColumn(
                name: "Hidden",
                table: "SessionTokens");

            migrationBuilder.DropColumn(
                name: "Light",
                table: "SessionTokens");

            migrationBuilder.DropColumn(
                name: "Perception",
                table: "SessionTokens");

            migrationBuilder.DropColumn(
                name: "RevealedTo",
                table: "SessionTokens");

            migrationBuilder.DropColumn(
                name: "Senses",
                table: "SessionTokens");

            migrationBuilder.DropColumn(
                name: "Vision",
                table: "SessionTokens");

            migrationBuilder.DropColumn(
                name: "TableSettings",
                table: "Sessions");

            migrationBuilder.DropColumn(
                name: "TableSettings",
                table: "RpgSystems");

            migrationBuilder.DropColumn(
                name: "LightMeters",
                table: "Characters");

            migrationBuilder.DropColumn(
                name: "Perception",
                table: "Characters");

            migrationBuilder.DropColumn(
                name: "ReachMeters",
                table: "Characters");

            migrationBuilder.DropColumn(
                name: "Senses",
                table: "Characters");

            migrationBuilder.DropColumn(
                name: "VisionMeters",
                table: "Characters");

            migrationBuilder.DropColumn(
                name: "TableSettings",
                table: "Campaigns");
        }
    }
}
