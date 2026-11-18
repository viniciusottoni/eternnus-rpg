using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Eternnus.Web.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class SmartStoreRotation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "LearnFromClicks",
                table: "StoreUserPreferences",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<bool>(
                name: "CatalogCoverage",
                table: "StoreSettings",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<int>(
                name: "FatigueImpressions",
                table: "StoreSettings",
                type: "integer",
                nullable: false,
                defaultValue: 6);

            migrationBuilder.AddColumn<bool>(
                name: "LearnFromClicks",
                table: "StoreSettings",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<int>(
                name: "RepeatWindow",
                table: "StoreSettings",
                type: "integer",
                nullable: false,
                defaultValue: 10);

            migrationBuilder.AddColumn<bool>(
                name: "RotateOnNavigation",
                table: "StoreSettings",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<int>(
                name: "ShareExplore",
                table: "StoreSettings",
                type: "integer",
                nullable: false,
                defaultValue: 10);

            migrationBuilder.AddColumn<int>(
                name: "ShareNew",
                table: "StoreSettings",
                type: "integer",
                nullable: false,
                defaultValue: 30);

            migrationBuilder.AddColumn<int>(
                name: "SharePopular",
                table: "StoreSettings",
                type: "integer",
                nullable: false,
                defaultValue: 40);

            migrationBuilder.AddColumn<int>(
                name: "ShareRelated",
                table: "StoreSettings",
                type: "integer",
                nullable: false,
                defaultValue: 20);

            migrationBuilder.AddColumn<bool>(
                name: "SmartRotation",
                table: "StoreSettings",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "PublishedAt",
                table: "StoreProducts",
                type: "timestamp with time zone",
                nullable: true);

            // Novidade conta da publicação (ADR-108); produtos já ativos herdam a data de cadastro.
            migrationBuilder.Sql("""UPDATE "StoreProducts" SET "PublishedAt" = "CreatedAt" WHERE "Status" = 'active';""");

            migrationBuilder.CreateTable(
                name: "StoreExposures",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ProductId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: false),
                    Cycle = table.Column<long>(type: "bigint", nullable: false),
                    Strategy = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ClickedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StoreExposures", x => x.Id);
                    table.ForeignKey(
                        name: "FK_StoreExposures_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_StoreExposures_StoreProducts_ProductId",
                        column: x => x.ProductId,
                        principalTable: "StoreProducts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "StoreRotationStates",
                columns: table => new
                {
                    UserId = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: false),
                    Cycle = table.Column<long>(type: "bigint", nullable: false),
                    ServedPopular = table.Column<long>(type: "bigint", nullable: false),
                    ServedNew = table.Column<long>(type: "bigint", nullable: false),
                    ServedRelated = table.Column<long>(type: "bigint", nullable: false),
                    ServedExplore = table.Column<long>(type: "bigint", nullable: false),
                    AdvancedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StoreRotationStates", x => x.UserId);
                    table.ForeignKey(
                        name: "FK_StoreRotationStates_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "StoreUserProductStats",
                columns: table => new
                {
                    UserId = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: false),
                    ProductId = table.Column<Guid>(type: "uuid", nullable: false),
                    Exposures = table.Column<int>(type: "integer", nullable: false),
                    LastCycle = table.Column<long>(type: "bigint", nullable: false),
                    FirstExposedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastExposedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StoreUserProductStats", x => new { x.UserId, x.ProductId });
                    table.ForeignKey(
                        name: "FK_StoreUserProductStats_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_StoreUserProductStats_StoreProducts_ProductId",
                        column: x => x.ProductId,
                        principalTable: "StoreProducts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_StoreExposures_CreatedAt",
                table: "StoreExposures",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_StoreExposures_ProductId_CreatedAt",
                table: "StoreExposures",
                columns: new[] { "ProductId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_StoreExposures_UserId_Cycle_ProductId",
                table: "StoreExposures",
                columns: new[] { "UserId", "Cycle", "ProductId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_StoreExposures_UserId_ProductId_CreatedAt",
                table: "StoreExposures",
                columns: new[] { "UserId", "ProductId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_StoreUserProductStats_LastExposedAt",
                table: "StoreUserProductStats",
                column: "LastExposedAt");

            migrationBuilder.CreateIndex(
                name: "IX_StoreUserProductStats_ProductId",
                table: "StoreUserProductStats",
                column: "ProductId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "StoreExposures");

            migrationBuilder.DropTable(
                name: "StoreRotationStates");

            migrationBuilder.DropTable(
                name: "StoreUserProductStats");

            migrationBuilder.DropColumn(
                name: "LearnFromClicks",
                table: "StoreUserPreferences");

            migrationBuilder.DropColumn(
                name: "CatalogCoverage",
                table: "StoreSettings");

            migrationBuilder.DropColumn(
                name: "FatigueImpressions",
                table: "StoreSettings");

            migrationBuilder.DropColumn(
                name: "LearnFromClicks",
                table: "StoreSettings");

            migrationBuilder.DropColumn(
                name: "RepeatWindow",
                table: "StoreSettings");

            migrationBuilder.DropColumn(
                name: "RotateOnNavigation",
                table: "StoreSettings");

            migrationBuilder.DropColumn(
                name: "ShareExplore",
                table: "StoreSettings");

            migrationBuilder.DropColumn(
                name: "ShareNew",
                table: "StoreSettings");

            migrationBuilder.DropColumn(
                name: "SharePopular",
                table: "StoreSettings");

            migrationBuilder.DropColumn(
                name: "ShareRelated",
                table: "StoreSettings");

            migrationBuilder.DropColumn(
                name: "SmartRotation",
                table: "StoreSettings");

            migrationBuilder.DropColumn(
                name: "PublishedAt",
                table: "StoreProducts");
        }
    }
}
