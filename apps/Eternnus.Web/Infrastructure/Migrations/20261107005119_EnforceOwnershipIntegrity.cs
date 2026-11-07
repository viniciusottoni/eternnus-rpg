using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Eternnus.Web.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class EnforceOwnershipIntegrity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_Events_UserId",
                table: "Events",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_Characters_OwnerId",
                table: "Characters",
                column: "OwnerId");

            migrationBuilder.AddForeignKey(
                name: "FK_Campaigns_AspNetUsers_OwnerId",
                table: "Campaigns",
                column: "OwnerId",
                principalTable: "AspNetUsers",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Characters_AspNetUsers_OwnerId",
                table: "Characters",
                column: "OwnerId",
                principalTable: "AspNetUsers",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Events_AspNetUsers_UserId",
                table: "Events",
                column: "UserId",
                principalTable: "AspNetUsers",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Members_AspNetUsers_UserId",
                table: "Members",
                column: "UserId",
                principalTable: "AspNetUsers",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Campaigns_AspNetUsers_OwnerId",
                table: "Campaigns");

            migrationBuilder.DropForeignKey(
                name: "FK_Characters_AspNetUsers_OwnerId",
                table: "Characters");

            migrationBuilder.DropForeignKey(
                name: "FK_Events_AspNetUsers_UserId",
                table: "Events");

            migrationBuilder.DropForeignKey(
                name: "FK_Members_AspNetUsers_UserId",
                table: "Members");

            migrationBuilder.DropIndex(
                name: "IX_Events_UserId",
                table: "Events");

            migrationBuilder.DropIndex(
                name: "IX_Characters_OwnerId",
                table: "Characters");
        }
    }
}
