using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Eternnus.Web.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class GuildHallOrder : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.UpdateData(
                table: "GuildCategories",
                keyColumn: "Id",
                keyValue: new Guid("00000000-0000-4000-8000-000000000202"),
                column: "Order",
                value: 3);

            migrationBuilder.UpdateData(
                table: "GuildCategories",
                keyColumn: "Id",
                keyValue: new Guid("00000000-0000-4000-8000-000000000203"),
                column: "Order",
                value: 4);

            migrationBuilder.UpdateData(
                table: "GuildCategories",
                keyColumn: "Id",
                keyValue: new Guid("00000000-0000-4000-8000-000000000204"),
                column: "Order",
                value: 7);

            migrationBuilder.UpdateData(
                table: "GuildCategories",
                keyColumn: "Id",
                keyValue: new Guid("00000000-0000-4000-8000-000000000205"),
                column: "Order",
                value: 5);

            migrationBuilder.UpdateData(
                table: "GuildCategories",
                keyColumn: "Id",
                keyValue: new Guid("00000000-0000-4000-8000-000000000206"),
                column: "Order",
                value: 8);

            migrationBuilder.UpdateData(
                table: "GuildCategories",
                keyColumn: "Id",
                keyValue: new Guid("00000000-0000-4000-8000-000000000207"),
                column: "Order",
                value: 2);

            migrationBuilder.UpdateData(
                table: "GuildCategories",
                keyColumn: "Id",
                keyValue: new Guid("00000000-0000-4000-8000-000000000208"),
                column: "Order",
                value: 6);

            migrationBuilder.UpdateData(
                table: "GuildCategories",
                keyColumn: "Id",
                keyValue: new Guid("00000000-0000-4000-8000-000000000209"),
                column: "Order",
                value: 1);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.UpdateData(
                table: "GuildCategories",
                keyColumn: "Id",
                keyValue: new Guid("00000000-0000-4000-8000-000000000202"),
                column: "Order",
                value: 1);

            migrationBuilder.UpdateData(
                table: "GuildCategories",
                keyColumn: "Id",
                keyValue: new Guid("00000000-0000-4000-8000-000000000203"),
                column: "Order",
                value: 2);

            migrationBuilder.UpdateData(
                table: "GuildCategories",
                keyColumn: "Id",
                keyValue: new Guid("00000000-0000-4000-8000-000000000204"),
                column: "Order",
                value: 3);

            migrationBuilder.UpdateData(
                table: "GuildCategories",
                keyColumn: "Id",
                keyValue: new Guid("00000000-0000-4000-8000-000000000205"),
                column: "Order",
                value: 4);

            migrationBuilder.UpdateData(
                table: "GuildCategories",
                keyColumn: "Id",
                keyValue: new Guid("00000000-0000-4000-8000-000000000206"),
                column: "Order",
                value: 5);

            migrationBuilder.UpdateData(
                table: "GuildCategories",
                keyColumn: "Id",
                keyValue: new Guid("00000000-0000-4000-8000-000000000207"),
                column: "Order",
                value: 6);

            migrationBuilder.UpdateData(
                table: "GuildCategories",
                keyColumn: "Id",
                keyValue: new Guid("00000000-0000-4000-8000-000000000208"),
                column: "Order",
                value: 7);

            migrationBuilder.UpdateData(
                table: "GuildCategories",
                keyColumn: "Id",
                keyValue: new Guid("00000000-0000-4000-8000-000000000209"),
                column: "Order",
                value: 8);
        }
    }
}
