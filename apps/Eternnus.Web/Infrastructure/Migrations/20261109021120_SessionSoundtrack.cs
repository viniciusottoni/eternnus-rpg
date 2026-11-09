using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Eternnus.Web.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class SessionSoundtrack : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "MusicLoop",
                table: "Sessions",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "MusicPlaying",
                table: "Sessions",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<long>(
                name: "MusicPositionMs",
                table: "Sessions",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<DateTime>(
                name: "MusicReferenceAt",
                table: "Sessions",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "MusicTrackId",
                table: "Sessions",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "MusicVersion",
                table: "Sessions",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateTable(
                name: "MusicTracks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Title = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    ContentType = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    SizeBytes = table.Column<long>(type: "bigint", nullable: false),
                    DurationMs = table.Column<int>(type: "integer", nullable: true),
                    Sha256 = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    StorageKey = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    UploadedById = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Revision = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MusicTracks", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Sessions_MusicTrackId",
                table: "Sessions",
                column: "MusicTrackId");

            migrationBuilder.CreateIndex(
                name: "IX_MusicTracks_Sha256",
                table: "MusicTracks",
                column: "Sha256");

            migrationBuilder.CreateIndex(
                name: "IX_MusicTracks_StorageKey",
                table: "MusicTracks",
                column: "StorageKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_MusicTracks_Title",
                table: "MusicTracks",
                column: "Title");

            migrationBuilder.AddForeignKey(
                name: "FK_Sessions_MusicTracks_MusicTrackId",
                table: "Sessions",
                column: "MusicTrackId",
                principalTable: "MusicTracks",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Sessions_MusicTracks_MusicTrackId",
                table: "Sessions");

            migrationBuilder.DropTable(
                name: "MusicTracks");

            migrationBuilder.DropIndex(
                name: "IX_Sessions_MusicTrackId",
                table: "Sessions");

            migrationBuilder.DropColumn(
                name: "MusicLoop",
                table: "Sessions");

            migrationBuilder.DropColumn(
                name: "MusicPlaying",
                table: "Sessions");

            migrationBuilder.DropColumn(
                name: "MusicPositionMs",
                table: "Sessions");

            migrationBuilder.DropColumn(
                name: "MusicReferenceAt",
                table: "Sessions");

            migrationBuilder.DropColumn(
                name: "MusicTrackId",
                table: "Sessions");

            migrationBuilder.DropColumn(
                name: "MusicVersion",
                table: "Sessions");
        }
    }
}
