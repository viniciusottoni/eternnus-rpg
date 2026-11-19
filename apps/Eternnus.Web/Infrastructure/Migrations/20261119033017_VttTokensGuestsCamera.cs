using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Eternnus.Web.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class VttTokensGuestsCamera : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "GuestSeatId",
                table: "SessionTokens",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Camera",
                table: "Sessions",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "GuestsEnabled",
                table: "Campaigns",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "GuestInvites",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CampaignId = table.Column<Guid>(type: "uuid", nullable: false),
                    Mode = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false),
                    Label = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    TokenHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    CreatedBy = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    RevokedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    MaxUses = table.Column<int>(type: "integer", nullable: false),
                    Uses = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GuestInvites", x => x.Id);
                    table.ForeignKey(
                        name: "FK_GuestInvites_Campaigns_CampaignId",
                        column: x => x.CampaignId,
                        principalTable: "Campaigns",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "PartySlots",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CampaignId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    Archetype = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    ImageUrl = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    Appearance = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: true),
                    Size = table.Column<int>(type: "integer", nullable: true),
                    Width = table.Column<int>(type: "integer", nullable: true),
                    Height = table.Column<int>(type: "integer", nullable: true),
                    CharacterId = table.Column<Guid>(type: "uuid", nullable: true),
                    Order = table.Column<int>(type: "integer", nullable: false),
                    Revision = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PartySlots", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PartySlots_Campaigns_CampaignId",
                        column: x => x.CampaignId,
                        principalTable: "Campaigns",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_PartySlots_Characters_CharacterId",
                        column: x => x.CharacterId,
                        principalTable: "Characters",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "GuestSeats",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    InviteId = table.Column<Guid>(type: "uuid", nullable: false),
                    CampaignId = table.Column<Guid>(type: "uuid", nullable: false),
                    SessionId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    Mode = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false),
                    SecretHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastSeenAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    RevokedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GuestSeats", x => x.Id);
                    table.ForeignKey(
                        name: "FK_GuestSeats_GuestInvites_InviteId",
                        column: x => x.InviteId,
                        principalTable: "GuestInvites",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_GuestSeats_Sessions_SessionId",
                        column: x => x.SessionId,
                        principalTable: "Sessions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_SessionTokens_GuestSeatId",
                table: "SessionTokens",
                column: "GuestSeatId");

            migrationBuilder.CreateIndex(
                name: "IX_GuestInvites_CampaignId_CreatedAt",
                table: "GuestInvites",
                columns: new[] { "CampaignId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_GuestInvites_TokenHash",
                table: "GuestInvites",
                column: "TokenHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_GuestSeats_InviteId",
                table: "GuestSeats",
                column: "InviteId");

            migrationBuilder.CreateIndex(
                name: "IX_GuestSeats_SecretHash",
                table: "GuestSeats",
                column: "SecretHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_GuestSeats_SessionId",
                table: "GuestSeats",
                column: "SessionId");

            migrationBuilder.CreateIndex(
                name: "IX_PartySlots_CampaignId_Order",
                table: "PartySlots",
                columns: new[] { "CampaignId", "Order" });

            migrationBuilder.CreateIndex(
                name: "IX_PartySlots_CharacterId",
                table: "PartySlots",
                column: "CharacterId");

            migrationBuilder.CreateIndex(
                name: "IX_PartySlots_OneCharacter",
                table: "PartySlots",
                columns: new[] { "CampaignId", "CharacterId" },
                unique: true,
                filter: "\"CharacterId\" IS NOT NULL");

            migrationBuilder.AddForeignKey(
                name: "FK_SessionTokens_GuestSeats_GuestSeatId",
                table: "SessionTokens",
                column: "GuestSeatId",
                principalTable: "GuestSeats",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_SessionTokens_GuestSeats_GuestSeatId",
                table: "SessionTokens");

            migrationBuilder.DropTable(
                name: "GuestSeats");

            migrationBuilder.DropTable(
                name: "PartySlots");

            migrationBuilder.DropTable(
                name: "GuestInvites");

            migrationBuilder.DropIndex(
                name: "IX_SessionTokens_GuestSeatId",
                table: "SessionTokens");

            migrationBuilder.DropColumn(
                name: "GuestSeatId",
                table: "SessionTokens");

            migrationBuilder.DropColumn(
                name: "Camera",
                table: "Sessions");

            migrationBuilder.DropColumn(
                name: "GuestsEnabled",
                table: "Campaigns");
        }
    }
}
