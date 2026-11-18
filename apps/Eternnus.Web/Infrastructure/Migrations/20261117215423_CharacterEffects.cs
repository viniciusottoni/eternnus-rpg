using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Eternnus.Web.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class CharacterEffects : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Effects",
                table: "Characters",
                type: "character varying(2000)",
                maxLength: 2000,
                nullable: false,
                defaultValue: "[]");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Effects",
                table: "Characters");
        }
    }
}
