using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Eternnus.Web.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class SceneEditorPresentation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "LayerKey",
                table: "Sessions",
                type: "character varying(80)",
                maxLength: 80,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SceneName",
                table: "Sessions",
                type: "character varying(80)",
                maxLength: 80,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SceneText",
                table: "Sessions",
                type: "character varying(2000)",
                maxLength: 2000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LayerMode",
                table: "Scenes",
                type: "character varying(10)",
                maxLength: 10,
                nullable: false,
                // Cenas existentes continuam com a camada compartilhada do mapa (comportamento anterior).
                defaultValue: "map");

            migrationBuilder.AddColumn<string>(
                name: "Prepared",
                table: "CampaignMapLayer",
                type: "character varying(400000)",
                maxLength: 400000,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "GridOffsetX",
                table: "CampaignMap",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "GridOffsetY",
                table: "CampaignMap",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<bool>(
                name: "HasGrid",
                table: "CampaignMap",
                type: "boolean",
                nullable: false,
                // Mapas enviados antes desta versão têm grade.
                defaultValue: true);

            migrationBuilder.AddColumn<string>(
                name: "InterfaceMode",
                table: "AspNetUsers",
                type: "character varying(10)",
                maxLength: 10,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "LayerKey",
                table: "Sessions");

            migrationBuilder.DropColumn(
                name: "SceneName",
                table: "Sessions");

            migrationBuilder.DropColumn(
                name: "SceneText",
                table: "Sessions");

            migrationBuilder.DropColumn(
                name: "LayerMode",
                table: "Scenes");

            migrationBuilder.DropColumn(
                name: "Prepared",
                table: "CampaignMapLayer");

            migrationBuilder.DropColumn(
                name: "GridOffsetX",
                table: "CampaignMap");

            migrationBuilder.DropColumn(
                name: "GridOffsetY",
                table: "CampaignMap");

            migrationBuilder.DropColumn(
                name: "HasGrid",
                table: "CampaignMap");

            migrationBuilder.DropColumn(
                name: "InterfaceMode",
                table: "AspNetUsers");
        }
    }
}
