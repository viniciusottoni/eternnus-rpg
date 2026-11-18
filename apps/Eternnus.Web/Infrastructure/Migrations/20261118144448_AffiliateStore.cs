using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace Eternnus.Web.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AffiliateStore : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "StoreCategories",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    Slug = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    Keywords = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    Order = table.Column<int>(type: "integer", nullable: false),
                    ArchivedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StoreCategories", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "StoreSettings",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false),
                    Enabled = table.Column<bool>(type: "boolean", nullable: false),
                    ShowcaseWide = table.Column<int>(type: "integer", nullable: false),
                    ShowcaseMedium = table.Column<int>(type: "integer", nullable: false),
                    ShowcaseNarrow = table.Column<int>(type: "integer", nullable: false),
                    Pages = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    MaxPerMarketplace = table.Column<int>(type: "integer", nullable: false),
                    CategoryDiversity = table.Column<bool>(type: "boolean", nullable: false),
                    RotationHours = table.Column<int>(type: "integer", nullable: false),
                    PriceStaleHours = table.Column<int>(type: "integer", nullable: false),
                    MetadataRefreshHours = table.Column<int>(type: "integer", nullable: false),
                    RequireImage = table.Column<bool>(type: "boolean", nullable: false),
                    Synonyms = table.Column<string>(type: "character varying(8000)", maxLength: 8000, nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Revision = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StoreSettings", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "StoreUserInterests",
                columns: table => new
                {
                    UserId = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: false),
                    Term = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    Weight = table.Column<double>(type: "double precision", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StoreUserInterests", x => new { x.UserId, x.Term });
                    table.ForeignKey(
                        name: "FK_StoreUserInterests_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "StoreUserPreferences",
                columns: table => new
                {
                    UserId = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: false),
                    ShowShowcase = table.Column<bool>(type: "boolean", nullable: false),
                    UseCampaignSystems = table.Column<bool>(type: "boolean", nullable: false),
                    AnalyzeMessages = table.Column<bool>(type: "boolean", nullable: false),
                    MessagesConsentAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    InterestSystemId = table.Column<Guid>(type: "uuid", nullable: true),
                    InterestsResetAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    InterestsComputedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StoreUserPreferences", x => x.UserId);
                    table.ForeignKey(
                        name: "FK_StoreUserPreferences_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_StoreUserPreferences_RpgSystems_InterestSystemId",
                        column: x => x.InterestSystemId,
                        principalTable: "RpgSystems",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "StoreProducts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Marketplace = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    AffiliateUrl = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    TargetUrl = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    CanonicalUrl = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    ExternalId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    Title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Description = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: false),
                    ImageUrl = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    Brand = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    CategoryId = table.Column<Guid>(type: "uuid", nullable: true),
                    PriceCents = table.Column<int>(type: "integer", nullable: true),
                    PreviousPriceCents = table.Column<int>(type: "integer", nullable: true),
                    Currency = table.Column<string>(type: "character varying(3)", maxLength: 3, nullable: false),
                    PriceCheckedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Availability = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Priority = table.Column<int>(type: "integer", nullable: false),
                    Clicks = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    DeletedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Revision = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StoreProducts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_StoreProducts_StoreCategories_CategoryId",
                        column: x => x.CategoryId,
                        principalTable: "StoreCategories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "StoreInteractions",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ProductId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: false),
                    Surface = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StoreInteractions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_StoreInteractions_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_StoreInteractions_StoreProducts_ProductId",
                        column: x => x.ProductId,
                        principalTable: "StoreProducts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "StoreProductSystems",
                columns: table => new
                {
                    ProductId = table.Column<Guid>(type: "uuid", nullable: false),
                    RpgSystemId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StoreProductSystems", x => new { x.ProductId, x.RpgSystemId });
                    table.ForeignKey(
                        name: "FK_StoreProductSystems_RpgSystems_RpgSystemId",
                        column: x => x.RpgSystemId,
                        principalTable: "RpgSystems",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_StoreProductSystems_StoreProducts_ProductId",
                        column: x => x.ProductId,
                        principalTable: "StoreProducts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "StoreProductTags",
                columns: table => new
                {
                    ProductId = table.Column<Guid>(type: "uuid", nullable: false),
                    Value = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StoreProductTags", x => new { x.ProductId, x.Value });
                    table.ForeignKey(
                        name: "FK_StoreProductTags_StoreProducts_ProductId",
                        column: x => x.ProductId,
                        principalTable: "StoreProducts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.InsertData(
                table: "StoreCategories",
                columns: new[] { "Id", "ArchivedAt", "Keywords", "Name", "Order", "Slug" },
                values: new object[,]
                {
                    { new Guid("00000000-0000-4000-8000-000000000301"), null, "livro basico, livro do jogador, regras, manual", "Livros básicos de RPG", 1, "livros-basicos" },
                    { new Guid("00000000-0000-4000-8000-000000000302"), null, "suplemento, expansao, bestiario, guia", "Suplementos e expansões", 2, "suplementos" },
                    { new Guid("00000000-0000-4000-8000-000000000303"), null, "aventura, campanha pronta, modulo, cenario", "Aventuras e campanhas prontas", 3, "aventuras" },
                    { new Guid("00000000-0000-4000-8000-000000000304"), null, "dado, dados, d20, dados metalicos, rolagem", "Dados e acessórios", 4, "dados" },
                    { new Guid("00000000-0000-4000-8000-000000000305"), null, "miniatura, miniaturas, figura, pintura", "Miniaturas", 5, "miniaturas" },
                    { new Guid("00000000-0000-4000-8000-000000000306"), null, "escudo do mestre, escudo do narrador", "Escudos do mestre", 6, "escudos" },
                    { new Guid("00000000-0000-4000-8000-000000000307"), null, "mapa, grid, battlemap, cenario fisico, terreno", "Mapas e cenários físicos", 7, "mapas" },
                    { new Guid("00000000-0000-4000-8000-000000000308"), null, "organizador, bandeja de dados, torre de dados, caixa", "Organizadores e acessórios de mesa", 8, "organizadores" },
                    { new Guid("00000000-0000-4000-8000-000000000309"), null, "carta, cartas, baralho, deck", "Cartas e baralhos", 9, "cartas" },
                    { new Guid("00000000-0000-4000-8000-000000000310"), null, "mestre, narrador, gerador, tabelas", "Materiais para mestres", 10, "mestres" },
                    { new Guid("00000000-0000-4000-8000-000000000311"), null, "colecionavel, edicao especial, estatueta", "Produtos colecionáveis", 11, "colecionaveis" },
                    { new Guid("00000000-0000-4000-8000-000000000312"), null, "", "Outros", 99, "outros" }
                });

            migrationBuilder.CreateIndex(
                name: "IX_StoreCategories_Name",
                table: "StoreCategories",
                column: "Name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_StoreCategories_Slug",
                table: "StoreCategories",
                column: "Slug",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_StoreInteractions_CreatedAt",
                table: "StoreInteractions",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_StoreInteractions_ProductId_CreatedAt",
                table: "StoreInteractions",
                columns: new[] { "ProductId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_StoreInteractions_UserId_ProductId_CreatedAt",
                table: "StoreInteractions",
                columns: new[] { "UserId", "ProductId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_StoreProducts_CategoryId",
                table: "StoreProducts",
                column: "CategoryId");

            migrationBuilder.CreateIndex(
                name: "IX_StoreProducts_Marketplace_ExternalId",
                table: "StoreProducts",
                columns: new[] { "Marketplace", "ExternalId" });

            migrationBuilder.CreateIndex(
                name: "IX_StoreProducts_Marketplace_Status",
                table: "StoreProducts",
                columns: new[] { "Marketplace", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_StoreProducts_PriceCents",
                table: "StoreProducts",
                column: "PriceCents");

            migrationBuilder.CreateIndex(
                name: "IX_StoreProducts_Status_DeletedAt_UpdatedAt",
                table: "StoreProducts",
                columns: new[] { "Status", "DeletedAt", "UpdatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_StoreProductSystems_RpgSystemId",
                table: "StoreProductSystems",
                column: "RpgSystemId");

            migrationBuilder.CreateIndex(
                name: "IX_StoreProductTags_Value",
                table: "StoreProductTags",
                column: "Value");

            migrationBuilder.CreateIndex(
                name: "IX_StoreUserPreferences_AnalyzeMessages_InterestsComputedAt",
                table: "StoreUserPreferences",
                columns: new[] { "AnalyzeMessages", "InterestsComputedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_StoreUserPreferences_InterestSystemId",
                table: "StoreUserPreferences",
                column: "InterestSystemId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "StoreInteractions");

            migrationBuilder.DropTable(
                name: "StoreProductSystems");

            migrationBuilder.DropTable(
                name: "StoreProductTags");

            migrationBuilder.DropTable(
                name: "StoreSettings");

            migrationBuilder.DropTable(
                name: "StoreUserInterests");

            migrationBuilder.DropTable(
                name: "StoreUserPreferences");

            migrationBuilder.DropTable(
                name: "StoreProducts");

            migrationBuilder.DropTable(
                name: "StoreCategories");
        }
    }
}
