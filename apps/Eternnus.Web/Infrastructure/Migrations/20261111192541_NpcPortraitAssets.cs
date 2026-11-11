using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Eternnus.Web.Infrastructure.Migrations
{
    /// <summary>
    /// Categoria isolada no acervo: imagens de NPC (<c>portrait</c>) deixam de aparecer como mapa.
    /// Retroclassifica de forma conservadora: só imagens sem grade ligadas a um NPC (ou com o nome gerado
    /// pelo envio do NPC) e que não sejam usadas por cena, sessão, atlas ou camada de névoa. Nada é apagado.
    /// </summary>
    public partial class NpcPortraitAssets : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Purpose",
                table: "CampaignMap",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "map");

            migrationBuilder.Sql("""
                UPDATE "CampaignMap" AS m SET "Purpose" = 'portrait'
                WHERE NOT m."HasGrid"
                  AND (
                    EXISTS (SELECT 1 FROM "MasterCharacters" n WHERE n."CampaignId" = m."CampaignId" AND n."ImageUrl" = 'asset:' || m."Id"::text)
                    OR m."Name" LIKE 'Imagem — %'
                  )
                  AND NOT EXISTS (SELECT 1 FROM "Scenes" s WHERE s."CampaignId" = m."CampaignId" AND s."MapKey" = 'asset:' || m."Id"::text)
                  AND NOT EXISTS (SELECT 1 FROM "Sessions" g WHERE g."MapKey" = 'asset:' || m."Id"::text)
                  AND NOT EXISTS (SELECT 1 FROM "AtlasPublication" a WHERE a."SourceMapId" = m."Id")
                  AND NOT EXISTS (SELECT 1 FROM "CampaignMapLayer" l WHERE l."CampaignId" = m."CampaignId"
                                  AND (l."MapKey" = 'asset:' || m."Id"::text OR l."MapKey" LIKE 'asset:' || m."Id"::text || '@%'));
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Purpose",
                table: "CampaignMap");
        }
    }
}
