using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Eternnus.Web.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class TokenAppearanceMoveGrant : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Appearance",
                table: "SessionTokens",
                type: "character varying(8)",
                maxLength: 8,
                nullable: false,
                // Marcadores existentes continuam redondos e com o tamanho de uma casa.
                defaultValue: "round");

            migrationBuilder.AddColumn<string>(
                name: "ImageUrl",
                table: "SessionTokens",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Size",
                table: "SessionTokens",
                type: "integer",
                nullable: false,
                defaultValue: 100);

            migrationBuilder.AddColumn<int>(
                name: "MoveGrantTurn",
                table: "Sessions",
                type: "integer",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Appearance",
                table: "SessionTokens");

            migrationBuilder.DropColumn(
                name: "ImageUrl",
                table: "SessionTokens");

            migrationBuilder.DropColumn(
                name: "Size",
                table: "SessionTokens");

            migrationBuilder.DropColumn(
                name: "MoveGrantTurn",
                table: "Sessions");
        }
    }
}
