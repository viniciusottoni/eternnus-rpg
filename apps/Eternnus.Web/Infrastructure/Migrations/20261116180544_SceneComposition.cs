using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Eternnus.Web.Infrastructure.Migrations
{
    /// <summary>
    /// Composição visual das cenas, pontos de entrada dos mapas e camada da cena na mesa. Aditiva: só colunas anuláveis e um índice; nada existente muda.
    /// </summary>
    public partial class SceneComposition : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "OverlayId",
                table: "Sessions",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Composition",
                table: "Scenes",
                type: "character varying(400000)",
                maxLength: 400000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Entry",
                table: "Scenes",
                type: "character varying(400)",
                maxLength: 400,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "OverlayId",
                table: "Scenes",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Entries",
                table: "CampaignMap",
                type: "character varying(4000)",
                maxLength: 4000,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "OwnerSceneId",
                table: "CampaignMap",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_CampaignMap_CampaignId_OwnerSceneId",
                table: "CampaignMap",
                columns: new[] { "CampaignId", "OwnerSceneId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_CampaignMap_CampaignId_OwnerSceneId",
                table: "CampaignMap");

            migrationBuilder.DropColumn(
                name: "OverlayId",
                table: "Sessions");

            migrationBuilder.DropColumn(
                name: "Composition",
                table: "Scenes");

            migrationBuilder.DropColumn(
                name: "Entry",
                table: "Scenes");

            migrationBuilder.DropColumn(
                name: "OverlayId",
                table: "Scenes");

            migrationBuilder.DropColumn(
                name: "Entries",
                table: "CampaignMap");

            migrationBuilder.DropColumn(
                name: "OwnerSceneId",
                table: "CampaignMap");
        }
    }
}
