using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Eternnus.Web.Infrastructure.Migrations
{
    /// <summary>
    /// Preparação unificada (ADR-081), aditiva: categoria das pastas (antigas viram "maps"), pasta/criação/camadas de cenas,
    /// pasta/criação de personagens do mestre e metadados, composição e imagens-fonte de mapas. Nada é apagado.
    /// </summary>
    public partial class PrepWorkspace : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "CreatedAt",
                table: "Scenes",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified));

            migrationBuilder.AddColumn<Guid>(
                name: "FolderId",
                table: "Scenes",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Layers",
                table: "Scenes",
                type: "character varying(4000)",
                maxLength: 4000,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "CreatedAt",
                table: "MasterCharacters",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified));

            migrationBuilder.AddColumn<Guid>(
                name: "FolderId",
                table: "MasterCharacters",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Category",
                table: "CampaignMapFolder",
                type: "character varying(12)",
                maxLength: 12,
                nullable: false,
                defaultValue: "maps");

            migrationBuilder.AddColumn<string>(
                name: "Composition",
                table: "CampaignMap",
                type: "character varying(400000)",
                maxLength: 400000,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "CreatedAt",
                table: "CampaignMap",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified));

            migrationBuilder.AddColumn<Guid>(
                name: "OwnerMapId",
                table: "CampaignMap",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SourceKey",
                table: "CampaignMap",
                type: "character varying(80)",
                maxLength: 80,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Summary",
                table: "CampaignMap",
                type: "character varying(500)",
                maxLength: 500,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<DateTime>(
                name: "UpdatedAt",
                table: "CampaignMap",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified));

            // Ordenação por criação: o melhor dado disponível é a última alteração; mapas não tinham data alguma.
            migrationBuilder.Sql("""
                UPDATE "Scenes" SET "CreatedAt" = "UpdatedAt";
                UPDATE "MasterCharacters" SET "CreatedAt" = "UpdatedAt";
                UPDATE "CampaignMap" SET "CreatedAt" = now(), "UpdatedAt" = now();
                """);

            migrationBuilder.CreateIndex(
                name: "IX_Scenes_FolderId",
                table: "Scenes",
                column: "FolderId");

            migrationBuilder.CreateIndex(
                name: "IX_MasterCharacters_FolderId",
                table: "MasterCharacters",
                column: "FolderId");

            migrationBuilder.CreateIndex(
                name: "IX_CampaignMapFolder_CampaignId_Category_ParentId",
                table: "CampaignMapFolder",
                columns: new[] { "CampaignId", "Category", "ParentId" });

            migrationBuilder.CreateIndex(
                name: "IX_CampaignMap_CampaignId_OwnerMapId",
                table: "CampaignMap",
                columns: new[] { "CampaignId", "OwnerMapId" });

            migrationBuilder.AddForeignKey(
                name: "FK_MasterCharacters_CampaignMapFolder_FolderId",
                table: "MasterCharacters",
                column: "FolderId",
                principalTable: "CampaignMapFolder",
                principalColumn: "Id");

            migrationBuilder.AddForeignKey(
                name: "FK_Scenes_CampaignMapFolder_FolderId",
                table: "Scenes",
                column: "FolderId",
                principalTable: "CampaignMapFolder",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_MasterCharacters_CampaignMapFolder_FolderId",
                table: "MasterCharacters");

            migrationBuilder.DropForeignKey(
                name: "FK_Scenes_CampaignMapFolder_FolderId",
                table: "Scenes");

            migrationBuilder.DropIndex(
                name: "IX_Scenes_FolderId",
                table: "Scenes");

            migrationBuilder.DropIndex(
                name: "IX_MasterCharacters_FolderId",
                table: "MasterCharacters");

            migrationBuilder.DropIndex(
                name: "IX_CampaignMapFolder_CampaignId_Category_ParentId",
                table: "CampaignMapFolder");

            migrationBuilder.DropIndex(
                name: "IX_CampaignMap_CampaignId_OwnerMapId",
                table: "CampaignMap");

            migrationBuilder.DropColumn(
                name: "CreatedAt",
                table: "Scenes");

            migrationBuilder.DropColumn(
                name: "FolderId",
                table: "Scenes");

            migrationBuilder.DropColumn(
                name: "Layers",
                table: "Scenes");

            migrationBuilder.DropColumn(
                name: "CreatedAt",
                table: "MasterCharacters");

            migrationBuilder.DropColumn(
                name: "FolderId",
                table: "MasterCharacters");

            migrationBuilder.DropColumn(
                name: "Category",
                table: "CampaignMapFolder");

            migrationBuilder.DropColumn(
                name: "Composition",
                table: "CampaignMap");

            migrationBuilder.DropColumn(
                name: "CreatedAt",
                table: "CampaignMap");

            migrationBuilder.DropColumn(
                name: "OwnerMapId",
                table: "CampaignMap");

            migrationBuilder.DropColumn(
                name: "SourceKey",
                table: "CampaignMap");

            migrationBuilder.DropColumn(
                name: "Summary",
                table: "CampaignMap");

            migrationBuilder.DropColumn(
                name: "UpdatedAt",
                table: "CampaignMap");
        }
    }
}
