using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Eternnus.Web.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class LegacyTextsToPages : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "ConvertedPageId",
                table: "CampaignLibraryEntry",
                type: "uuid",
                nullable: true);

            // ADR-063: objetivos e pistas do Diário passam a ser páginas do Mundo. Copia os antigos sem apagar:
            // publicado vira "Toda a mesa", rascunho vira "Só eu"; o dono é o mestre. O texto antigo guarda a página criada.
            migrationBuilder.Sql("""
                WITH src AS (
                    SELECT e."Id" AS entry_id, gen_random_uuid() AS page_id, e."CampaignId", c."OwnerId", e."Kind", e."Title", e."Text", e."Published", e."UpdatedAt"
                    FROM "CampaignLibraryEntry" e JOIN "Campaigns" c ON c."Id" = e."CampaignId"
                    WHERE e."Kind" IN ('objective', 'clue') AND e."ConvertedPageId" IS NULL
                ), created AS (
                    INSERT INTO "WorkspacePage" ("Id", "CampaignId", "OwnerId", "Kind", "Title", "Content", "Secrets", "Visibility", "Collection", "Tags", "Status", "RelatedReferences", "Pinned", "Order", "Revision", "UpdatedAt")
                    SELECT page_id, "CampaignId", "OwnerId", "Kind", "Title", "Text", '', CASE WHEN "Published" THEN 'table' ELSE 'self' END, '', '', 'open', '', false, 0, 1, "UpdatedAt" FROM src
                    RETURNING "Id"
                )
                UPDATE "CampaignLibraryEntry" e SET "ConvertedPageId" = src.page_id FROM src WHERE e."Id" = src.entry_id;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // As páginas copiadas são preservadas (podem ter sido editadas); só o vínculo com o texto antigo é removido.
            migrationBuilder.DropColumn(
                name: "ConvertedPageId",
                table: "CampaignLibraryEntry");
        }
    }
}
