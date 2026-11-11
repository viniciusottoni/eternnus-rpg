using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace Eternnus.Web.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class GuildModerationHold : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "HeldAt",
                table: "GuildTopics",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "HeldAt",
                table: "GuildPosts",
                type: "timestamp with time zone",
                nullable: true);

            // Salões novos (ADR-068). ON CONFLICT preserva bancos em que a administração já criou um salão com o mesmo id ou identificador.
            migrationBuilder.Sql("""
                INSERT INTO "GuildCategories" ("Id", "ArchivedAt", "Description", "MinLevelToPost", "Name", "Order", "Slug", "StaffOnly") VALUES
                ('00000000-0000-4000-8000-000000000207', NULL, 'Sugestões de melhorias e novos recursos para a plataforma.', 1, 'Forja de Ideias', 6, 'forja-de-ideias', FALSE),
                ('00000000-0000-4000-8000-000000000208', NULL, 'Mapas, retratos, tokens e artes criadas pela comunidade.', 1, 'Galeria do Artífice', 7, 'galeria-do-artifice', FALSE),
                ('00000000-0000-4000-8000-000000000209', NULL, 'Dúvidas de quem está começando no RPG ou na Eternnus.', 1, 'Portal do Aprendiz', 8, 'portal-do-aprendiz', FALSE)
                ON CONFLICT DO NOTHING;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DeleteData(
                table: "GuildCategories",
                keyColumn: "Id",
                keyValue: new Guid("00000000-0000-4000-8000-000000000207"));

            migrationBuilder.DeleteData(
                table: "GuildCategories",
                keyColumn: "Id",
                keyValue: new Guid("00000000-0000-4000-8000-000000000208"));

            migrationBuilder.DeleteData(
                table: "GuildCategories",
                keyColumn: "Id",
                keyValue: new Guid("00000000-0000-4000-8000-000000000209"));

            migrationBuilder.DropColumn(
                name: "HeldAt",
                table: "GuildTopics");

            migrationBuilder.DropColumn(
                name: "HeldAt",
                table: "GuildPosts");
        }
    }
}
