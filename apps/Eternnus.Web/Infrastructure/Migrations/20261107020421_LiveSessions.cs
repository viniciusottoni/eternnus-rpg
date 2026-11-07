using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Eternnus.Web.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class LiveSessions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Sessions_CampaignId",
                table: "Sessions");

            migrationBuilder.RenameColumn(
                name: "StartsAt",
                table: "Sessions",
                newName: "StartedAt");

            migrationBuilder.RenameColumn(
                name: "Notes",
                table: "Sessions",
                newName: "Objective");

            migrationBuilder.AddColumn<Guid>(
                name: "ActiveCharacterId",
                table: "Sessions",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "EndedAt",
                table: "Sessions",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "LastActiveCharacterId",
                table: "Sessions",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "MapKey",
                table: "Sessions",
                type: "character varying(80)",
                maxLength: 80,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "MapKind",
                table: "Sessions",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<int>(
                name: "Number",
                table: "Sessions",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "Revision",
                table: "Sessions",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "TurnNumber",
                table: "Sessions",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "Data",
                table: "Events",
                type: "character varying(4000)",
                maxLength: 4000,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<bool>(
                name: "MasterOnly",
                table: "Events",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<Guid>(
                name: "SessionId",
                table: "Events",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Actions",
                table: "Characters",
                type: "jsonb",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Armor",
                table: "Characters",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "Constitution",
                table: "Characters",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "Movement",
                table: "Characters",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateTable(
                name: "SessionParticipants",
                columns: table => new
                {
                    SessionId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: false),
                    CharacterId = table.Column<Guid>(type: "uuid", nullable: true),
                    IsMaster = table.Column<bool>(type: "boolean", nullable: false),
                    JoinedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastSeenAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SessionParticipants", x => new { x.SessionId, x.UserId });
                    table.ForeignKey(
                        name: "FK_SessionParticipants_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_SessionParticipants_Characters_CharacterId",
                        column: x => x.CharacterId,
                        principalTable: "Characters",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_SessionParticipants_Sessions_SessionId",
                        column: x => x.SessionId,
                        principalTable: "Sessions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "SessionTokens",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    SessionId = table.Column<Guid>(type: "uuid", nullable: false),
                    CharacterId = table.Column<Guid>(type: "uuid", nullable: true),
                    Label = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    Side = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    X = table.Column<int>(type: "integer", nullable: false),
                    Y = table.Column<int>(type: "integer", nullable: false),
                    LastMovedTurn = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SessionTokens", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SessionTokens_Characters_CharacterId",
                        column: x => x.CharacterId,
                        principalTable: "Characters",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_SessionTokens_Sessions_SessionId",
                        column: x => x.SessionId,
                        principalTable: "Sessions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            // Dados anteriores: sessões agendadas viram capítulos encerrados e numerados; fichas recebem os novos atributos padrão.
            migrationBuilder.Sql("""
                UPDATE "Sessions" AS s SET
                    "Number" = ordered.n,
                    "EndedAt" = s."StartedAt",
                    "MapKind" = 'cartographic',
                    "MapKey" = 'valley',
                    "Revision" = 1
                FROM (SELECT "Id", ROW_NUMBER() OVER (PARTITION BY "CampaignId" ORDER BY "StartedAt", "Id") AS n FROM "Sessions") AS ordered
                WHERE s."Id" = ordered."Id";
                UPDATE "Characters" SET "Constitution" = 10, "Armor" = 10, "Movement" = 9, "Actions" = '[]'::jsonb;
                """);

            migrationBuilder.CreateIndex(
                name: "IX_Sessions_CampaignId_Number",
                table: "Sessions",
                columns: new[] { "CampaignId", "Number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Sessions_OneActivePerCampaign",
                table: "Sessions",
                column: "CampaignId",
                unique: true,
                filter: "\"EndedAt\" IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_Events_SessionId_Id",
                table: "Events",
                columns: new[] { "SessionId", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_SessionParticipants_CharacterId",
                table: "SessionParticipants",
                column: "CharacterId");

            migrationBuilder.CreateIndex(
                name: "IX_SessionParticipants_UserId",
                table: "SessionParticipants",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_SessionTokens_CharacterId",
                table: "SessionTokens",
                column: "CharacterId");

            migrationBuilder.CreateIndex(
                name: "IX_SessionTokens_SessionId",
                table: "SessionTokens",
                column: "SessionId");

            migrationBuilder.AddForeignKey(
                name: "FK_Events_Sessions_SessionId",
                table: "Events",
                column: "SessionId",
                principalTable: "Sessions",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Events_Sessions_SessionId",
                table: "Events");

            migrationBuilder.DropTable(
                name: "SessionParticipants");

            migrationBuilder.DropTable(
                name: "SessionTokens");

            migrationBuilder.DropIndex(
                name: "IX_Sessions_CampaignId_Number",
                table: "Sessions");

            migrationBuilder.DropIndex(
                name: "IX_Sessions_OneActivePerCampaign",
                table: "Sessions");

            migrationBuilder.DropIndex(
                name: "IX_Events_SessionId_Id",
                table: "Events");

            migrationBuilder.DropColumn(
                name: "ActiveCharacterId",
                table: "Sessions");

            migrationBuilder.DropColumn(
                name: "EndedAt",
                table: "Sessions");

            migrationBuilder.DropColumn(
                name: "LastActiveCharacterId",
                table: "Sessions");

            migrationBuilder.DropColumn(
                name: "MapKey",
                table: "Sessions");

            migrationBuilder.DropColumn(
                name: "MapKind",
                table: "Sessions");

            migrationBuilder.DropColumn(
                name: "Number",
                table: "Sessions");

            migrationBuilder.DropColumn(
                name: "Revision",
                table: "Sessions");

            migrationBuilder.DropColumn(
                name: "TurnNumber",
                table: "Sessions");

            migrationBuilder.DropColumn(
                name: "Data",
                table: "Events");

            migrationBuilder.DropColumn(
                name: "MasterOnly",
                table: "Events");

            migrationBuilder.DropColumn(
                name: "SessionId",
                table: "Events");

            migrationBuilder.DropColumn(
                name: "Actions",
                table: "Characters");

            migrationBuilder.DropColumn(
                name: "Armor",
                table: "Characters");

            migrationBuilder.DropColumn(
                name: "Constitution",
                table: "Characters");

            migrationBuilder.DropColumn(
                name: "Movement",
                table: "Characters");

            migrationBuilder.RenameColumn(
                name: "StartedAt",
                table: "Sessions",
                newName: "StartsAt");

            migrationBuilder.RenameColumn(
                name: "Objective",
                table: "Sessions",
                newName: "Notes");

            migrationBuilder.CreateIndex(
                name: "IX_Sessions_CampaignId",
                table: "Sessions",
                column: "CampaignId");
        }
    }
}
