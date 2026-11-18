using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Eternnus.Web.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class CharacterItemNotes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ItemNotes",
                table: "Characters",
                type: "character varying(150000)",
                maxLength: 150000,
                nullable: false,
                defaultValue: "{}");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ItemNotes",
                table: "Characters");
        }
    }
}
