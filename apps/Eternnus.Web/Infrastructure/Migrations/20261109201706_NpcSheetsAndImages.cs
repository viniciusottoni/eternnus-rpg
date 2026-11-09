using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Eternnus.Web.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class NpcSheetsAndImages : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ImageUrl",
                table: "MasterCharacters",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Kind",
                table: "MasterCharacters",
                type: "character varying(10)",
                maxLength: 10,
                nullable: false,
                defaultValue: "npc");

            migrationBuilder.AddColumn<Guid>(
                name: "TemplateVersionId",
                table: "MasterCharacters",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Values",
                table: "MasterCharacters",
                type: "character varying(100000)",
                maxLength: 100000,
                nullable: false,
                defaultValue: "{}");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ImageUrl",
                table: "MasterCharacters");

            migrationBuilder.DropColumn(
                name: "Kind",
                table: "MasterCharacters");

            migrationBuilder.DropColumn(
                name: "TemplateVersionId",
                table: "MasterCharacters");

            migrationBuilder.DropColumn(
                name: "Values",
                table: "MasterCharacters");
        }
    }
}
