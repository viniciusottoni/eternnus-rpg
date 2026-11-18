using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Eternnus.Web.Infrastructure.Migrations
{
    /// <summary>ADR-099: SheetField.Notes e SheetField.Roll vivem na coluna JSON "Fields" das versões de modelo.
    /// Não há mudança de esquema; a migração só registra o modelo (versões antigas leem as propriedades como nulas = automático).</summary>
    public partial class SheetFieldNotesRoll : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
        }
    }
}
