using Eternnus.Web;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;
namespace Eternnus.Tests;
public sealed class WorkspaceTests : IAsyncLifetime
{
    readonly SqliteConnection connection = new("Data Source=:memory:");
    GameDb db = null!;
    WorkspaceService service = null!;
    Campaign campaign = new() { OwnerId = "master", Name = "Continuidade", Origin = "ongoing", FirstSessionNumber = 28 };
    static JsonElement Json(object o) => JsonSerializer.SerializeToElement(o);
    public async Task InitializeAsync()
    {
        await connection.OpenAsync(); db = new(new DbContextOptionsBuilder<GameDb>().UseSqlite(connection).Options); await db.Database.EnsureCreatedAsync();
        foreach (var id in new[] { "master", "player", "other", "outsider" }) db.Users.Add(new AppUser { Id = id, NormalizedEmail = id.ToUpperInvariant() });
        db.AddRange(campaign, new Member { CampaignId = campaign.Id, UserId = "player" }, new Member { CampaignId = campaign.Id, UserId = "other" }); await db.SaveChangesAsync(); service = new(db);
    }
    public async Task DisposeAsync() { await db.DisposeAsync(); await connection.DisposeAsync(); }
    [Fact]
    public async Task Personal_notes_exclude_master_and_shared_readers_cannot_edit()
    {
        var p = await service.Save(campaign.Id, null, "player", new("Teoria", "A rainha é uma impostora", "note", Secrets:"segredo"), default);
        Assert.Equal(0, Json(await service.List(campaign.Id, "master", null, null, 1, false, default)).GetProperty("total").GetInt32());
        Assert.Equal(404, (await Assert.ThrowsAsync<RuleException>(() => service.Read(campaign.Id,p.Id,"master",default))).Status);
        await service.Save(campaign.Id,p.Id,"player",new("Teoria","texto","note","master","segredo",Revision:p.Revision),default);
        var read = Json(await service.Read(campaign.Id,p.Id,"master",default)); Assert.Equal("",read.GetProperty("secrets").GetString()); Assert.False(read.GetProperty("canEdit").GetBoolean());
        Assert.Equal(404,(await Assert.ThrowsAsync<RuleException>(()=>service.Save(campaign.Id,p.Id,"master",new("Alterado","x","note",Revision:2),default))).Status);
        Assert.Equal(404,(await Assert.ThrowsAsync<RuleException>(()=>service.Versions(campaign.Id,p.Id,"master",default))).Status);
    }
    [Fact]
    public async Task Selected_readers_are_scoped_and_access_can_be_recollected()
    {
        var p=await service.Save(campaign.Id,null,"player",new("Aliança","x","note","selected",Recipients:["other"]),default);
        await service.Read(campaign.Id,p.Id,"other",default);
        Assert.Equal(404,(await Assert.ThrowsAsync<RuleException>(()=>service.Read(campaign.Id,p.Id,"master",default))).Status);
        await service.Save(campaign.Id,p.Id,"player",new("Aliança","x","note","self",Revision:p.Revision),default);
        Assert.Equal(404,(await Assert.ThrowsAsync<RuleException>(()=>service.Read(campaign.Id,p.Id,"other",default))).Status);
        Assert.Equal(400,(await Assert.ThrowsAsync<RuleException>(()=>service.Save(campaign.Id,null,"player",new("x","x","note","selected",Recipients:["outsider"]),default))).Status);
    }
    [Fact]
    public async Task Version_conflicts_trash_and_private_parents_are_enforced()
    {
        var parent=await service.Save(campaign.Id,null,"master",new("Livro secreto","x","book"),default);
        var p=await service.Save(campaign.Id,null,"master",new("Capítulo","x","chapter","table",ParentId:parent.Id),default);
        Assert.Equal(JsonValueKind.Null,Json(await service.Read(campaign.Id,p.Id,"player",default)).GetProperty("parent").ValueKind);
        await service.Save(campaign.Id,p.Id,"master",new("Capítulo","novo","chapter","table",Revision:1),default);
        Assert.Equal(409,(await Assert.ThrowsAsync<RuleException>(()=>service.Save(campaign.Id,p.Id,"master",new("x","x",Revision:1),default))).Status);
        Assert.Single(await db.Set<WorkspaceVersion>().ToListAsync());
        await service.Delete(campaign.Id,p.Id,"master",2,false,default);
        Assert.Equal(404,(await Assert.ThrowsAsync<RuleException>(()=>service.Read(campaign.Id,p.Id,"player",default))).Status);
        await service.Delete(campaign.Id,p.Id,"master",3,true,default); await service.Read(campaign.Id,p.Id,"player",default);
        Assert.Equal(403,(await Assert.ThrowsAsync<RuleException>(()=>service.Save(campaign.Id,null,"player",new("x","x","place"),default))).Status);
    }
    [Fact]
    public async Task Past_sessions_continue_numbering_without_XP_or_active_sessions()
    {
        await service.SavePast(campaign.Id,null,"master",new(27,"Última sessão","Resumo"),default);
        Assert.Empty(await db.Sessions.ToListAsync()); Assert.Empty(await db.XpEntries.ToListAsync());
        Assert.Equal(0,Json(await service.Past(campaign.Id,"player",1,default)).GetProperty("total").GetInt32());
        var sessions=new SessionService(db,new SessionSignals(),TimeProvider.System); await sessions.StartAsync(campaign.Id,new("Continuação","",MapKinds.Tileset,"crypt"),"master",default);
        Assert.Equal(28,(await db.Sessions.SingleAsync()).Number);
        Assert.Equal(409,(await Assert.ThrowsAsync<RuleException>(()=>service.SavePast(campaign.Id,null,"master",new(28,"Duplicada","x"),default))).Status);
    }
    [Fact]
    public async Task Past_sessions_record_optional_scenes_in_order_with_limits()
    {
        var saved=await service.SavePast(campaign.Id,null,"master",new(3,"A cripta","",Published:true,Scenes:[new(" A entrada ","Os heróis abriram o portão."),new("",""),new(null,"O esqueleto despertou.")]),default);
        Assert.Equal(["A entrada","Cena 2"],saved.Scenes.Select(s=>s.Title));
        Assert.Equal("O esqueleto despertou.",saved.Scenes[1].Text);
        db.ChangeTracker.Clear();
        var listed=Json(await service.Past(campaign.Id,"player",1,default)).GetProperty("items")[0].GetProperty("Scenes");
        Assert.Equal(2,listed.GetArrayLength());
        Assert.Equal(400,(await Assert.ThrowsAsync<RuleException>(()=>service.SavePast(campaign.Id,saved.Id,"master",new(3,"A cripta","",Revision:saved.Revision,Scenes:[new("Só título","")]),default))).Status);
        Assert.Equal(400,(await Assert.ThrowsAsync<RuleException>(()=>service.SavePast(campaign.Id,saved.Id,"master",new(3,"A cripta","",Revision:saved.Revision,Scenes:Enumerable.Range(0,31).Select(i=>new PastSceneInput(null,"x")).ToList()),default))).Status);
        Assert.Equal(400,(await Assert.ThrowsAsync<RuleException>(()=>service.SavePast(campaign.Id,saved.Id,"master",new(3,"A cripta","",Revision:saved.Revision,Scenes:[new(null,new string('x',10001))]),default))).Status);
        Assert.Equal(400,(await Assert.ThrowsAsync<RuleException>(()=>service.SavePast(campaign.Id,saved.Id,"master",new(3,"A cripta","",Revision:saved.Revision,Scenes:Enumerable.Range(0,7).Select(i=>new PastSceneInput(null,new string('x',9000))).ToList()),default))).Status);
        db.ChangeTracker.Clear();
        var cleared=await service.SavePast(campaign.Id,saved.Id,"master",new(3,"A cripta","Resumo único",Revision:saved.Revision),default);
        Assert.Empty(cleared.Scenes);
    }
    [Fact]
    public async Task Attachments_follow_current_permissions_and_atlas_is_a_snapshot()
    {
        var p=await service.Save(campaign.Id,null,"master",new("Livro","x","book"),default);
        await service.Attach(campaign.Id,p.Id,"master",new([1,2],DocumentKinds.Pdf,"livro.pdf",""),default);
        Assert.Equal(404,(await Assert.ThrowsAsync<RuleException>(()=>service.Attachments(campaign.Id,p.Id,"player",default))).Status);
        await service.Save(campaign.Id,p.Id,"master",new("Livro","x","book","table",Revision:1),default);
        var file=await db.Set<WorkspaceAttachment>().SingleAsync(); Assert.Equal(2,(await service.Attachment(campaign.Id,p.Id,file.Id,"player",default)).Content.Length);
        var map=new CampaignMap {CampaignId=campaign.Id,Name="Reino",Content=[3,4]};db.Add(map);await db.SaveChangesAsync();
        await service.PublishMap(campaign.Id,map.Id,"master",false,default);map.Content=[5,6];await db.SaveChangesAsync();
        var publication=await db.Set<AtlasPublication>().SingleAsync();Assert.Equal(new byte[]{3,4},await service.AtlasImage(campaign.Id,publication.Id,"player",default));
        await service.PublishMap(campaign.Id,map.Id,"master",true,default);Assert.Equal(404,(await Assert.ThrowsAsync<RuleException>(()=>service.AtlasImage(campaign.Id,publication.Id,"player",default))).Status);
    }
    [Fact]
    public async Task Notes_survive_leaving_and_campaign_deletion_but_outsiders_do_not_read_them()
    {
        var p=await service.Save(campaign.Id,null,"player",new("Lembranças","texto","note"),default);
        db.Members.Remove(await db.Members.SingleAsync(m=>m.CampaignId==campaign.Id&&m.UserId=="player"));await db.SaveChangesAsync();
        await service.OwnNote(p.Id,"player",default);Assert.Equal(404,(await Assert.ThrowsAsync<RuleException>(()=>service.OwnNote(p.Id,"outsider",default))).Status);
        db.Campaigns.Remove(campaign);await db.SaveChangesAsync();await service.OwnNote(p.Id,"player",default);
    }
    [Fact]
    public async Task Links_backlinks_and_search_do_not_disclose_private_pages()
    {
        var hidden = await service.Save(campaign.Id,null,"master",new("Segredo","x","place"),default);
        var shown = await service.Save(campaign.Id,null,"master",new("Porto","Conhecido","place","table",Related:[hidden.Id]),default);
        Assert.Equal(0,Json(await service.Read(campaign.Id,shown.Id,"player",default)).GetProperty("related").GetArrayLength());
        Assert.Equal(0,Json(await service.List(campaign.Id,"player","Segredo",null,1,false,default)).GetProperty("total").GetInt32());
        await service.Save(campaign.Id,hidden.Id,"master",new("Segredo","x","place","self",Revision:1,Related:[shown.Id]),default);
        Assert.Equal(0,Json(await service.Read(campaign.Id,shown.Id,"player",default)).GetProperty("backlinks").GetArrayLength());
        Assert.Equal(400,(await Assert.ThrowsAsync<RuleException>(()=>service.Save(campaign.Id,null,"player",new("Nota","x","note",Related:[hidden.Id]),default))).Status);
    }
    [Fact]
    public async Task Archived_campaigns_reject_writes_and_private_exports_survive()
    {
        var p=await service.Save(campaign.Id,null,"player",new("Nota","x","note"),default);
        campaign.ArchivedAt=DateTime.UtcNow;await db.SaveChangesAsync();
        await service.Read(campaign.Id,p.Id,"player",default);
        Assert.Equal(409,(await Assert.ThrowsAsync<RuleException>(()=>service.Save(campaign.Id,p.Id,"player",new("x","x","note",Revision:1),default))).Status);
        Assert.Equal(409,(await Assert.ThrowsAsync<RuleException>(()=>service.SavePast(campaign.Id,null,"master",new(1,"x","x"),default))).Status);
    }

    [Fact]
    public async Task Chapters_are_master_only_ordered_and_group_past_sessions()
    {
        Assert.Equal(403,(await Assert.ThrowsAsync<RuleException>(()=>service.SaveChapter(campaign.Id,null,"player",new("Ato I"),default))).Status);
        Assert.Equal(403,(await Assert.ThrowsAsync<RuleException>(()=>service.ChapterList(campaign.Id,"player",default))).Status);
        Assert.Equal(400,(await Assert.ThrowsAsync<RuleException>(()=>service.SaveChapter(campaign.Id,null,"master",new("Ato I","livro"),default))).Status);
        Assert.Equal(400,(await Assert.ThrowsAsync<RuleException>(()=>service.SaveChapter(campaign.Id,null,"master",new("  "),default))).Status);
        var one=await service.SaveChapter(campaign.Id,null,"master",new(" Ato I ","act","Chegada a Valkaria"),default);
        var two=await service.SaveChapter(campaign.Id,null,"master",new("Ato II","act"),default);
        Assert.Equal("Ato I",one.Title); Assert.Equal(0,one.Order); Assert.Equal(1,two.Order);
        await service.MoveChapter(campaign.Id,two.Id,"master",new(-1,two.Revision),default);
        var past=await service.SavePast(campaign.Id,null,"master",new(5,"A ponte","",ChapterId:one.Id),default);
        await service.SavePast(campaign.Id,null,"master",new(6,"Avulsa",""),default);
        var list=Json(await service.ChapterList(campaign.Id,"master",default));
        var items=list.GetProperty("items");
        Assert.Equal("Ato II",items[0].GetProperty("Title").GetString());
        Assert.Equal(1,items[1].GetProperty("pastCount").GetInt32()); Assert.Equal(5,items[1].GetProperty("firstNumber").GetInt32());
        Assert.Equal(1,list.GetProperty("looseSessions").GetInt32());
        Assert.Equal(409,(await Assert.ThrowsAsync<RuleException>(()=>service.SaveChapter(campaign.Id,one.Id,"master",new("Ato I",Revision:one.Revision-1),default))).Status);
        var current=await db.Set<StoryChapter>().AsNoTracking().SingleAsync(c=>c.Id==one.Id);
        await service.DeleteChapter(campaign.Id,one.Id,"master",current.Revision,default);
        Assert.Null((await db.Set<PastSession>().AsNoTracking().SingleAsync(p=>p.Id==past.Id)).ChapterId);
    }

}

