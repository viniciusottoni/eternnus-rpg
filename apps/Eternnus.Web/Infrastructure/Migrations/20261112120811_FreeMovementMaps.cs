using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Eternnus.Web.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class FreeMovementMaps : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "Fx",
                table: "SessionTokens",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Fy",
                table: "SessionTokens",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "FreeMovement",
                table: "CampaignMap",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Fx",
                table: "SessionTokens");

            migrationBuilder.DropColumn(
                name: "Fy",
                table: "SessionTokens");

            migrationBuilder.DropColumn(
                name: "FreeMovement",
                table: "CampaignMap");
        }
    }
}
