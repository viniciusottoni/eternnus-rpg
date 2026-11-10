using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Eternnus.Web.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class WorkspaceReferences : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "Snapshot",
                table: "WorkspaceVersion",
                type: "character varying(100000)",
                maxLength: 100000,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(20000)",
                oldMaxLength: 20000);

            migrationBuilder.AddColumn<bool>(
                name: "Pinned",
                table: "WorkspacePage",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "RelatedReferences",
                table: "WorkspacePage",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: false,
                defaultValue: "");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Pinned",
                table: "WorkspacePage");

            migrationBuilder.DropColumn(
                name: "RelatedReferences",
                table: "WorkspacePage");

            migrationBuilder.AlterColumn<string>(
                name: "Snapshot",
                table: "WorkspaceVersion",
                type: "character varying(20000)",
                maxLength: 20000,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(100000)",
                oldMaxLength: 100000);
        }
    }
}
