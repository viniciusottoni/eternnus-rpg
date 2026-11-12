// Arte procedural do tileset oficial. Coordenadas locais em 0–100, sem imagens externas.
// Apenas apresentação: a grade recebida continua sendo a fonte de colisão e visibilidade.
const TAU = Math.PI * 2;
function noise(x, y, seed = 0) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed + 1, 1597334677);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
const at = (rows, x, y) => rows[y]?.[x] ?? "?";
const wall = c => c === "#" || c === "T";
function shape(g, points, fill, stroke, width = 1) {
  g.beginPath();
  points.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y));
  g.closePath();
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = width; g.stroke(); }
}
function line(g, points, color, width = 1) {
  g.beginPath();
  points.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y));
  g.strokeStyle = color; g.lineWidth = width; g.stroke();
}
function ellipse(g, x, y, rx, ry, color) {
  g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU);
  g.fillStyle = color; g.fill();
}
function gradient(g, light, dark, x = 0, y = 0, w = 100, h = 100) {
  const v = g.createLinearGradient(x, y, w, h);
  v.addColorStop(0, light); v.addColorStop(1, dark); return v;
}
function flecks(g, rand, count, colors) {
  for (let i = 0; i < count; i++) {
    g.fillStyle = colors[i % colors.length];
    g.fillRect(rand(i + 40) * 100, rand(i + 170) * 100, .7 + rand(i + 270) * 1.7, .7);
  }
}
function rock(g, cx, cy, radius, rand, seed, colors) {
  const pts = Array.from({ length: 7 }, (_, i) => {
    const a = i * TAU / 7, r = radius * (.74 + rand(seed + i) * .26);
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r * .78];
  });
  shape(g, pts.map(([x, y]) => [x + 3, y + 5]), "#080e0c66");
  shape(g, pts, gradient(g, colors[0], colors[1], cx-radius,cy-radius,cx+radius,cy+radius), "#161e1bb0", 1.1);
  shape(g, [pts[3], pts[4], pts[5], [cx - radius * .12, cy - radius * .1]], colors[2]);
  line(g, [pts[3], pts[4], pts[5], pts[6]], "#e4d8ac35", 1);
  line(g, [[cx - 2, cy - radius * .3], [cx + 3, cy + 2], pts[1]], "#0c161a55");
}
function stoneFloor(g, x, y, rand, detail) {
  g.fillStyle = "#292d29"; g.fillRect(0, 0, 100, 100);
  for (let row = 0; row < 2; row++) {
    const offset = (row + y) % 2 ? -25 : 0;
    for (let col = 0; col < 3; col++) {
      const bx = offset + col * 53, by = row * 51, n = rand(10 + row * 3 + col);
      const pts = [[bx+3,by+3],[bx+46,by+1],[bx+51,by+7],[bx+50,by+44],[bx+44,by+49],[bx+2,by+47]];
      shape(g, pts, gradient(g, `hsl(39 13% ${31+n*5}%)`, `hsl(36 12% ${23+n*5}%)`), "#191e1a", 1.2);
      line(g, pts.slice(0, 3), "#cfc4a72e", 1.2);
      if (detail && n > .55) line(g, [[bx+32,by+3],[bx+28,by+13],[bx+34,by+20],[bx+30,by+26]], "#161d1c80", 1);
    }
  }
  if (detail) flecks(g, rand, 23, ["#cbbd9625", "#0d171b35"]);
}
function wood(g, x, y, rand, detail) {
  g.fillStyle = "#302219"; g.fillRect(0, 0, 100, 100);
  for (let i = 0; i < 5; i++) {
    const yy = i * 20, n = noise(x, y * 5 + i);
    g.fillStyle = gradient(g, `hsl(32 33% ${35+n*6}%)`, `hsl(28 33% ${24+n*5}%)`, 0, yy, 0, yy+20);
    g.fillRect(0, yy+1, 100, 18);
    line(g, [[0,yy+2],[100,yy+2]], "#d6ae673f", .8);
    const seam = ((x + y + i) % 3) * 34 + 14;
    line(g, [[seam,yy],[seam,yy+20]], "#241b14", 1.3);
    if (detail) {
      for (let j = 0; j < 3; j++) {
        g.beginPath(); g.moveTo(0, yy+6+j*4);
        g.bezierCurveTo(30, yy+rand(i+j+20)*15, 50, yy+5+j*4, 100, yy+7+j*4);
        g.strokeStyle = j % 2 ? "#e8bf7930" : "#20150c50"; g.lineWidth = .7; g.stroke();
      }
      ellipse(g, seam+4, yy+5, 1.2, 1.2, "#181a17");
      ellipse(g, seam-4, yy+15, 1.2, 1.2, "#181a17");
      if (n > .6) ellipse(g, 67, yy+11, 5, 1.8, "#2c1e1766");
    }
  }
}
function grass(g, x, y, rand, detail) {
  // Grandes manchas atravessam as casas: o campo não vira um tabuleiro verde.
  g.fillStyle = gradient(g, "#4a5932", "#304831", -x*100, -y*100, 2800-x*100, 1800-y*100);
  g.fillRect(0, 0, 100, 100);
  for (let i = 0; i < (detail ? 32 : 8); i++) {
    const bx = rand(i+10)*100, by = rand(i+100)*100, h = 3+rand(i+200)*6;
    line(g, [[bx-3,by-h*.7],[bx,by],[bx+1,by-h],[bx,by],[bx+4,by-h*.6]], i%3 ? "#9aab5b40" : "#142e2490", .8);
    if (detail && i % 5 === 0) shape(g, [[bx,by],[bx+4,by-2],[bx+6,by],[bx+2,by+1]], "#c1a26050");
  }
}
function sand(g, x, y, rand, detail) {
  g.fillStyle = gradient(g, "#9a8760", "#77694d", -x*100, -y*100, 2800-x*100, 1800-y*100); g.fillRect(0,0,100,100);
  if (detail) {
    for (let i=0;i<4;i++) {
      g.beginPath(); g.moveTo(0,i*27+8);
      g.bezierCurveTo(35,i*27-4,60,i*27+20,100,i*27+7);
      g.strokeStyle="#e3ce9833"; g.lineWidth=1.2; g.stroke();
    }
    flecks(g,rand,35,["#f0d7a14a","#423f323f"]);
  }
}
function water(g, rows, x, y, rand, detail) {
  g.fillStyle = gradient(g, "#356167", "#183d4b", -x*100, -y*100, 2800-x*100, 1800-y*100); g.fillRect(0,0,100,100);
  for (let i=0;i<(detail ? 9 : 3);i++) {
    const xx=rand(i+30)*90, yy=rand(i+70)*100;
    g.beginPath(); g.moveTo(xx,yy); g.bezierCurveTo(xx+7,yy-3,xx+12,yy+4,xx+23,yy);
    g.strokeStyle=i%3 ? "#93c5b12b" : "#0b2d4144"; g.lineWidth=1.2; g.stroke();
  }
  // Margem recortada dentro da água; não avança sobre uma casa caminhável ou desconhecida.
  for (let edge=0;edge<4;edge++) {
    const [dx,dy]=[[0,-1],[1,0],[0,1],[-1,0]][edge], neighbor=at(rows,x+dx,y+dy);
    if (neighbor === "~" || neighbor === "?") continue;
    g.save(); g.translate(50,50); g.rotate(edge*Math.PI/2); g.translate(-50,-50);
    const lip=[[0,0],[100,0],[100,5],[84,8],[69,5],[52,10],[36,7],[20,11],[0,7]];
    shape(g,lip,"#192b2b99");
    line(g,lip.slice(2),"#bad4ac75",1.4);
    if (neighbor !== "d") for(let i=0;i<4;i++) rock(g,i*27+7,2,5,rand,edge*20+i,["#8b8c70","#4d655b","#adac86"]);
    g.restore();
  }
}
function masonry(g, rows, x, y, rand, detail) {
  g.fillStyle="#242827"; g.fillRect(0,0,100,100);
  for(let row=0;row<3;row++) for(let col=-1;col<2;col++) {
    const xx=col*60+(row%2)*30, yy=row*25, n=rand(row*4+col+5);
    shape(g,[[xx+2,yy+2],[xx+56,yy+1],[xx+59,yy+7],[xx+56,yy+23],[xx+3,yy+23],[xx,yy+17]],gradient(g,`hsl(42 12% ${34+n*5}%)`,`hsl(38 11% ${24+n*5}%)`),"#121b1c",1.7);
    line(g,[[xx+4,yy+3],[xx+54,yy+3]],"#d1c6a344",1);
  }
  if (!wall(at(rows,x,y+1)) && at(rows,x,y+1) !== "?") {
    g.fillStyle=gradient(g,"#716852","#333a35",0,70,0,100); g.fillRect(0,71,100,29);
    line(g,[[0,72],[100,72]],"#c5b382",2);
    line(g,[[0,96],[100,96]],"#162123",6);
    for(let i=0;i<3;i++) line(g,[[i*39+12,74],[i*39+12,94]],"#252d28",2);
  }
  if(detail) {
    flecks(g,rand,35,["#d4c8a22a","#09161c42"]);
    if(rand(18)>.45) line(g,[[61,3],[56,15],[64,22],[59,36]],"#111c1c99",1.4);
    for(let i=0;i<7;i++) ellipse(g,rand(i+25)*100,rand(i+70)*65,2+rand(i+95)*5,2,"#69724538");
  }
}
function tree(g, rand, detail) {
  ellipse(g,56,65,42,28,"#0b17118c");
  shape(g,[[44,55],[56,48],[58,76],[70,87],[54,80],[48,92],[44,77],[31,85],[42,70]],gradient(g,"#a08450","#483e29"));
  line(g,[[49,60],[50,78],[47,85]],"#d0a96380",2);
  // Copa recortada, galhos e agrupamentos de folhas com luz superior.
  const crown = (cx,cy,r,seed,color) => {
    const pts=Array.from({length:22},(_,i)=>{
      const a=i*TAU/22, rr=r*(i%2 ? .78 : .88+rand(seed+i)*.12);
      return [cx+Math.cos(a)*rr,cy+Math.sin(a)*rr*.84];
    });
    shape(g,pts,color,"#142f2490",.9);
  };
  crown(49,44,47,40,gradient(g,"#536b39","#1b3d2b"));
  for(let i=0;i<6;i++) {
    const a=i*TAU/6, cx=47+Math.cos(a)*24,cy=40+Math.sin(a)*19;
    line(g,[[49,60],[46,43],[cx,cy]],"#95805465",2.4);
    crown(cx,cy,21+rand(i+80)*4,90+i*23,gradient(g,i%2 ? "#73854a" : "#5e7b42","#2a5031",cx-20,cy-20,cx+20,cy+20));
  }
  crown(43,32,22,230,gradient(g,"#8a9552","#3c6236",25,12,62,52));
  if(detail) for(let i=0;i<56;i++) {
    const a=rand(i+320)*TAU,r=Math.sqrt(rand(i+400))*35,xx=46+Math.cos(a)*r,yy=39+Math.sin(a)*r*.8;
    shape(g,[[xx-2,yy],[xx+1,yy-2],[xx+4,yy],[xx,yy+1.5]],i%3 ? "#bbbf7345" : "#122f2455");
  }
}
function furniture(g, rows, x, y, timber, rand, detail) {
  const l=timber && at(rows,x-1,y)==="h" ? 0 : 10, r=timber && at(rows,x+1,y)==="h" ? 100 : 90;
  const top=timber && at(rows,x,y-1)==="h" ? 0 : 12, bottom=timber && at(rows,x,y+1)==="h" ? 100 : 79;
  g.fillStyle="#080b0b66"; g.fillRect(l+4,top+10,r-l,Math.min(95,bottom+14)-top);
  g.fillStyle="#3b281d"; g.fillRect(l,top+9,r-l,bottom-top+6);
  // A iluminação e as bordas seguem o móvel conectado, sem dividir o tampo em blocos.
  let first=x,last=x;
  if(timber) {
    while(at(rows,first-1,y)==="h") first--;
    while(at(rows,last+1,y)==="h") last++;
  }
  shape(g,[[l,top],[r,top],[r,bottom],[l,bottom]],gradient(g,"#a27c48","#79532e",(first-x)*100,0,(last-x+1)*100,0));
  if(l) line(g,[[l,top],[l,bottom]],"#d1aa6c99",2);
  if(r<100) line(g,[[r,top],[r,bottom]],"#392b1e",2);
  if(top) line(g,[[l,top],[r,top]],"#d1aa6c99",2);
  if(bottom<100) line(g,[[l,bottom],[r,bottom]],"#392b1e",2);
  for(let i=1;i<4;i++) line(g,[[l+2,top+(bottom-top)*i/4],[r-2,top+(bottom-top)*i/4]],"#38291c99",1.4);
  if(!timber) {
    // Caixote de carga: travessas, ferragens e pregos.
    shape(g,[[l+3,top+7],[l+10,top+3],[r-3,bottom-8],[r-10,bottom-3]],"#b28b51","#513c23",1.5);
    shape(g,[[l+3,bottom-8],[r-10,top+3],[r-3,top+8],[l+10,bottom-3]],"#987342","#513c23",1.5);
    for(const xx of [l+5,r-8]) { g.fillStyle="#303c39"; g.fillRect(xx,top+2,4,bottom-top-3); }
  } else if(detail && rand(40)>.46) {
    ellipse(g,35,34,10,7,"#27271f88"); ellipse(g,33,31,9,7,"#b7b39a"); ellipse(g,33,31,6,4,"#737962");
    ellipse(g,66,55,5,5,"#292a20"); ellipse(g,65,53,5,4,"#b39150"); ellipse(g,65,52,3,2,"#3b2a1e");
  }
  if(detail) for(const xx of [l+5,r-5]) for(const yy of [top+5,bottom-5]) ellipse(g,xx,yy,1.5,1.5,"#d9bd7e");
}
function pillar(g) {
  ellipse(g,57,72,36,20,"#0b141b80");
  shape(g,[[20,61],[30,48],[71,48],[81,61],[77,84],[23,84]],gradient(g,"#8d8a72","#424c48"),"#263430",2);
  shape(g,[[29,31],[39,24],[65,24],[72,32],[69,71],[60,78],[38,76],[29,67]],gradient(g,"#b0a17c","#4a5852"),"#303e37",1.5);
  for(let i=0;i<4;i++) line(g,[[36+i*9,36],[36+i*9,68]],i%2 ? "#ddd1a666" : "#2a3b3988",2.5);
  shape(g,[[22,25],[33,16],[68,16],[79,27],[73,39],[29,39]],gradient(g,"#bbad86","#72765f"),"#34443a",2);
  shape(g,[[33,21],[65,21],[71,28],[65,33],[35,32],[29,28]],"#8e9276","#d3c6a166",1);
  line(g,[[59,20],[53,28],[57,33]],"#405047",1.6);
}
function altar(g, rows, x, y) {
  const l=at(rows,x-1,y)==="A" ? 0 : 9,r=at(rows,x+1,y)==="A" ? 100 : 91;
  g.fillStyle="#07141b80";g.fillRect(l+4,30,r-l,63);
  shape(g,[[l,28],[r,28],[r,82],[l,82]],gradient(g,"#818475","#3d504c"),"#253b39",2);
  shape(g,[[l,19],[r-3,19],[r,25],[r,61],[l+3,61],[l,56]],gradient(g,"#b7b49a","#707d6b"),"#344b44",2);
  line(g,[[l+3,23],[r-3,23]],"#ece1b988",2);
  line(g,[[l+3,71],[r-3,71]],"#c4a467",2);
  shape(g,[[44,22],[61,22],[64,84],[55,79],[47,85]],"#763c32","#cca963",1);
  line(g,[[52,30],[58,38],[51,47],[49,38],[56,34]],"#e0c77d",1.5);
  for(const xx of [23,78]) {
    ellipse(g,xx,37,6,3,"#4c5143");g.fillStyle="#e6d4a0";g.fillRect(xx-2,26,4,10);
    shape(g,[[xx-2,25],[xx,19],[xx+2,25]],"#f8d781");
  }
}
function brazier(g) {
  ellipse(g,54,72,30,17,"#10181b88");
  for(const xx of [31,68]) line(g,[[xx,48],[xx+(xx<50 ? -5 : 5),76],[xx+(xx<50 ? 3 : -3),79]],"#252c2c",5);
  shape(g,[[22,43],[78,43],[70,63],[57,71],[40,69],[28,60]],gradient(g,"#7c7960","#283635"),"#182b2d",2);
  ellipse(g,50,43,29,15,"#b09863");ellipse(g,50,43,25,12,"#302a20");
  line(g,[[32,45],[62,51]],"#9a572c",6);line(g,[[43,51],[65,37]],"#6e4b2a",6);
  for(const xx of [35,46,61]) shape(g,[[xx-3,47],[xx,39],[xx+4,45],[xx,50]],"#d78942");
}
function door(g, rows, x, y) {
  g.save();
  if(wall(at(rows,x,y-1)) && wall(at(rows,x,y+1))) {g.translate(100,0);g.rotate(Math.PI/2);}
  g.fillStyle="#101c1c80";g.fillRect(2,30,96,39);
  shape(g,[[5,35],[94,35],[94,56],[5,56]],gradient(g,"#b08c51","#674529"),"#292c23",2);
  for(let i=0;i<7;i++) line(g,[[12+i*12,36],[12+i*12,55]],"#4b3523",1);
  for(const xx of [19,77]) {g.fillStyle="#36403b";g.fillRect(xx,34,5,24);ellipse(g,xx+2,39,1,1,"#c0b78d");}
  for(const xx of [0,91]) {g.fillStyle="#9a9375";g.fillRect(xx,28,9,36);}
  ellipse(g,59,49,3,3,"#dab36a");g.restore();
}

const SURFACES = { t: ",", p: "n", a: "s", C: ":", P: ":", R: "e", i: "v", X: "v", j: "u", w: "u", H: "c", F: ",", q: "c", E: "s", M: "c", B: "d", k: ".", g: ",", O: ".", N: ".", Y: "." };
const GROUND = ".,d:nsevufc", groundCache = new WeakMap();
// Objetos acompanham o chão vizinho: rocha na neve e árvore na mata não ganham um quadrado de outro bioma.
// Cada grade é imutável; o cache fraco desaparece junto com a camada de desenho.
function objectGround(rows, x, y, fallback) {
  let dominant=groundCache.get(rows);
  if(dominant===undefined) {
    const counts=new Map();
    for(const row of rows)for(const c of row)if(GROUND.includes(c))counts.set(c,(counts.get(c)||0)+1);
    dominant=[...counts].sort((a,b)=>b[1]-a[1])[0]?.[0]||"";groundCache.set(rows,dominant);
  }
  const nearby=new Map();
  for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++) {
    if(!dx&&!dy)continue;
    const c=at(rows,x+dx,y+dy);
    if(GROUND.includes(c))nearby.set(c,(nearby.get(c)||0)+1/(dx*dx+dy*dy));
  }
  return [...nearby].sort((a,b)=>b[1]-a[1])[0]?.[0]||dominant||fallback;
}
function wildGround(g, type, x, y, rand, detail) {
  const colors = { n: ["#d7ded5", "#94acb0"], s: ["#92864b", "#6c6938"], e: ["#88704c", "#61523b"], v: ["#44434a", "#262d32"], u: ["#416f70", "#244d59"], f: ["#35462a", "#1f3628"], c: ["#888775", "#59625c"] };
  const [light,dark] = colors[type];
  g.fillStyle = gradient(g,light,dark,-x*100,-y*100,2800-x*100,1800-y*100);g.fillRect(0,0,100,100);
  if(type === "c") {
    for(let row=0;row<4;row++) for(let col=-1;col<4;col++) {
      const xx=col*31+(row%2)*15, yy=row*25;
      shape(g,[[xx+3,yy+2],[xx+27,yy+1],[xx+30,yy+8],[xx+26,yy+23],[xx+2,yy+21]],gradient(g,light,dark,xx,yy,xx+30,yy+25),"#34413d88",1.3);
    }
  }
  if(!detail) return;
  flecks(g,rand,35,[light+"44",dark+"77"]);
  if(type === "v") {
    for(let i=0;i<3;i++) {const xx=rand(i+20)*90,yy=rand(i+40)*70;line(g,[[xx,yy],[xx+7,yy+14],[xx+2,yy+27],[xx+19,yy+36]],"#101f2380",1.5);}
  } else if("sfu".includes(type)) {
    for(let i=0;i<18;i++) {const xx=rand(i+10)*100,yy=rand(i+80)*100;line(g,[[xx-4,yy-5],[xx,yy],[xx+2,yy-7]],type === "s" ? "#e1c97c88" : "#72a47755",1);}
  } else if(type === "n") {
    for(let i=0;i<6;i++) {const xx=rand(i+10)*100,yy=rand(i+60)*100;line(g,[[xx-8,yy+2],[xx,yy],[xx+11,yy+1]],"#eef1df88",1.7);}
  }
}
function lava(g, rand, detail) {
  g.fillStyle=gradient(g,"#c56a28","#65302a");g.fillRect(0,0,100,100);
  for(let i=0;i<(detail?9:4);i++) {
    const x=rand(i+20)*100,y=rand(i+60)*100;
    shape(g,[[x-17,y-10],[x+4,y-15],[x+18,y-3],[x+9,y+13],[x-15,y+9]],"#3c3334","#efae4844",2);
    line(g,[[x-20,y+12],[x-2,y+16],[x+12,y+9]],"#fbc760aa",1.7);
  }
}
function vegetation(g, type, rand) {
  ellipse(g,55,73,35,18,"#0b201d66");
  if(type === "p") {
    shape(g,[[44,56],[56,56],[57,91],[44,91]],"#6a583b");
    for(let i=0;i<3;i++) {
      const cy=69-i*19, width=37-i*8;
      shape(g,[[50,cy-37],[50+width,cy+10],[64,cy+8],[50,cy+15],[34,cy+9],[50-width,cy+11]],gradient(g,"#4d7464","#193e36"),"#17372f",1.5);
      line(g,[[50,cy-34],[40,cy-14],[35,cy-11]],"#d7e1cfbb",3);
    }
  } else if(type === "a") {
    shape(g,[[47,90],[44,49],[27,36],[32,33],[51,50],[70,33],[74,36],[55,57],[55,90]],"#65583d","#3c4831",1);
    for(let i=0;i<6;i++) rock(g,18+i*13,27+Math.sin(i)*5,18,rand,50+i*12,["#92934c","#4b6733","#a4a458"]);
  } else if(type === "P") {
    shape(g,[[44,91],[49,42],[57,37],[53,91]],"#a18150","#57482c",1.5);
    for(let i=0;i<7;i++) {
      const a=i*TAU/7,xx=50+Math.cos(a)*43,yy=38+Math.sin(a)*31;
      shape(g,[[50,38],[xx,yy-8],[xx-5,yy+8],[50+Math.cos(a)*12,43]],gradient(g,"#8e9c53","#35643f"),"#284f3b",1);
      line(g,[[50,38],[xx,yy]],"#afae6666",1);
    }
  } else if(type === "C") {
    line(g,[[51,83],[51,24]],"#274d37",17);line(g,[[48,81],[48,24]],"#74965b",10);
    line(g,[[49,58],[29,58],[29,39]],"#4b7950",11);line(g,[[52,48],[72,48],[72,31]],"#4b7950",11);
    for(let i=0;i<6;i++) line(g,[[43,30+i*8],[48,32+i*8]],"#e3d49a",1);
    ellipse(g,51,20,5,3,"#c78a6b");
  } else if(type === "w" || type === "j") {
    for(let i=0;i<5;i++) {
      const xx=23+i*12,yy=24+rand(i+20)*20;
      g.beginPath();g.moveTo(50,84);g.bezierCurveTo(xx-20,65,xx+20,50,xx,yy);
      g.strokeStyle=type === "j" ? ["#d4997c","#a36377","#e2b48c"][i%3] : "#62a391";g.lineWidth=type === "j"?5:3;g.stroke();
      if(type === "j") line(g,[[xx,yy+10],[xx-7,yy+2]],"#dda58b",3);
    }
    if(type === "j") rock(g,51,83,20,rand,90,["#8ca69a","#486b65","#aec3a2"]);
  }
}
function monument(g,type) {
  ellipse(g,54,78,32,15,"#111e2266");
  if(type === "g") {
    shape(g,[[27,76],[29,35],[39,24],[60,24],[71,35],[72,76]],gradient(g,"#b0af91","#59685c"),"#334b43",2);
    line(g,[[40,45],[59,45]],"#495b50",2);line(g,[[50,37],[50,59]],"#495b50",2);
    shape(g,[[22,76],[77,76],[80,84],[19,84]],"#83907b");
  } else if(type === "O") {
    shape(g,[[29,15],[69,15],[79,34],[72,88],[27,88],[22,34]],"#485951","#263a34",2);
    shape(g,[[32,10],[66,10],[74,29],[67,79],[32,79],[27,29]],gradient(g,"#b9b093","#788775"),"#d4c8a577",2);
    ellipse(g,49,29,8,8,"#566c60");shape(g,[[44,39],[56,39],[61,63],[39,63]],"#566c60");
    line(g,[[39,48],[59,57],[40,57],[58,48]],"#c1baa0",2);
  } else if(type === "N") {
    shape(g,[[22,77],[76,77],[81,90],[17,90]],"#839184","#344a43",2);
    shape(g,[[44,33],[59,33],[72,74],[30,74]],gradient(g,"#c3c5ae","#627f74"),"#38534b",2);
    ellipse(g,50,23,12,14,"#a6b39f");line(g,[[32,48],[21,67]],"#9ba995",8);line(g,[[67,47],[79,38],[79,76]],"#8f9a81",6);
  } else {
    shape(g,[[21,19],[31,9],[69,9],[79,19],[74,82],[26,82]],gradient(g,"#b09861","#685030"),"#d4b875",2);
    shape(g,[[33,20],[66,20],[64,58],[35,58]],"#733d3c","#dfb872",2);
    shape(g,[[30,58],[70,58],[72,77],[28,77]],"#96514b","#d7b169",2);
    for(const xx of [24,72]) {g.fillStyle="#c0a26a";g.fillRect(xx,52,5,34);}
  }
}
function building(g,type,rows,x,y) {
  if(type === "F") {
    const vertical=at(rows,x,y-1)==="F" || at(rows,x,y+1)==="F";
    g.save();if(vertical){g.translate(100,0);g.rotate(Math.PI/2);}
    for(const yy of [40,61]) {g.fillStyle="#755d39";g.fillRect(0,yy,100,7);line(g,[[0,yy],[100,yy]],"#c1a46c",1);}
    for(const xx of [12,75])shape(g,[[xx,32],[xx+5,26],[xx+10,32],[xx+10,78],[xx,78]],"#9d7b4a","#4c4c32",1);g.restore();return;
  }
  ellipse(g,55,75,42,20,"#0b182366");
  if(type === "q") {
    ellipse(g,50,66,32,24,"#4a5b54");ellipse(g,50,56,32,21,"#a7a78c");ellipse(g,50,56,23,14,"#25434a");
    for(const xx of [22,73]) {g.fillStyle="#856744";g.fillRect(xx,23,6,46);}
    line(g,[[24,24],[76,24]],"#a68b5c",6);line(g,[[50,24],[50,57]],"#c4b185",1.5);
  } else if(type === "E") {
    shape(g,[[7,81],[44,16],[57,15],[93,81]],gradient(g,"#cbb483","#7e7654"),"#484e35",2);
    shape(g,[[44,17],[56,17],[67,80],[33,80]],"#3c4941");line(g,[[49,17],[13,81]],"#f1d4a3",1.5);
    for(const xx of [8,90])line(g,[[50,16],[xx,88]],"#ccb88b",1);
  } else if(type === "M") {
    g.fillStyle="#5b4632";g.fillRect(12,36,76,46);
    for(let i=0;i<5;i++)shape(g,[[10+i*16,15],[26+i*16,15],[29+i*16,48],[7+i*16,48]],i%2?"#c1b68c":"#8e4e43","#69573c",1);
    g.fillStyle="#a18150";g.fillRect(12,64,76,17);
    for(let i=0;i<7;i++)ellipse(g,22+i*9,69,4,3,i%2?"#c2a659":"#7b995a");
  } else {
    const left=at(rows,x-1,y)==="H",right=at(rows,x+1,y)==="H",top=at(rows,x,y-1)==="H",bottom=at(rows,x,y+1)==="H";
    let first=x,last=x;while(at(rows,first-1,y)==="H")first--;while(at(rows,last+1,y)==="H")last++;
    const ridge=((first+last+1)/2-x)*100;
    g.fillStyle="#524a40";g.fillRect(0,18,100,82);
    const roofTop=top?0:9,roofBottom=bottom?100:91;
    g.fillStyle=gradient(g,"#a66e50","#66433b",ridge-150,0,ridge+150,0);g.fillRect(0,roofTop,100,roofBottom-roofTop);
    for(let yy=roofTop+5;yy<roofBottom;yy+=13) {
      line(g,[[0,yy],[100,yy]],"#dfac7666",1.5);
      for(let xx=(Math.floor(yy/13)%2)*12;xx<100;xx+=24)line(g,[[xx,yy],[xx,Math.min(yy+12,roofBottom)]],"#482d3266",1);
    }
    if(!top)line(g,[[0,roofTop],[100,roofTop]],"#d1ab79",3);
    if(!bottom)line(g,[[0,roofBottom],[100,roofBottom]],"#3b3030",4);
    if(!left)line(g,[[2,roofTop],[2,roofBottom]],"#d1ab79",2);
    if(!right)line(g,[[98,roofTop],[98,roofBottom]],"#3b3030",3);
    line(g,[[ridge,roofTop],[ridge,roofBottom]],"#d1ab79",3);
    if(!left&&!right) {g.fillStyle="#686659";g.fillRect(68,22,13,22);g.fillStyle="#263236";g.fillRect(70,22,9,5);}
  }
}
function treasure(g,type) {
  ellipse(g,54,77,31,16,"#08192377");
  if(type === "B") {
    shape(g,[[31,18],[66,18],[76,37],[73,76],[64,87],[33,87],[23,74],[24,38]],gradient(g,"#b18c50","#61452d"),"#354039",2);
    for(let i=0;i<4;i++)line(g,[[34+i*10,25],[31+i*11,78]],"#453c2e",1.4);
    for(const yy of [33,70])line(g,[[26,yy],[73,yy]],"#697b72",6);
    ellipse(g,49,22,21,9,"#bb9a61");ellipse(g,49,22,17,6,"#6b573b");
  } else {
    shape(g,[[19,36],[28,24],[72,24],[82,36],[82,79],[19,79]],gradient(g,"#ac884b","#58432c"),"#293d34",2);
    line(g,[[20,48],[81,48]],"#2a3328",3);
    for(const xx of [29,67]){g.fillStyle="#bcaa70";g.fillRect(xx,28,5,51);}
    g.fillStyle="#d2bc78";g.fillRect(45,43,10,15);ellipse(g,50,49,2,2,"#28352c");
  }
}

/** Desenho compartilhado entre miniaturas, editor e mesa; omite detalhes finos em escalas pequenas. */
export function drawTile(g, rows, x, y, size, outdoor, timber) {
  const c=at(rows,x,y),rand=seed=>noise(x,y,seed),detail=size>=22;
  g.save();g.translate(x*size,y*size);g.scale(size/100,size/100);
  // Recorte por casa, inclusive sombras e galhos, para respeitar a névoa.
  g.beginPath();g.rect(0,0,100,100);g.clip();
  if(c==="?") {g.fillStyle="#050403";g.fillRect(0,0,100,100);g.restore();return;}
  let surface=c;
  if(SURFACES[c]) surface=objectGround(rows,x,y,SURFACES[c]);
  if(c==="S") surface=[...rows[y].slice(0,x)].reverse().find(t=>t!=="S" && t!=="?") || (outdoor ? "," : timber ? "d" : ".");
  if(wall(c)) masonry(g,rows,x,y,rand,detail);
  else if(c==="~") water(g,rows,x,y,rand,detail);
  else if(c==="L") lava(g,rand,detail);
  else {
    if("nsevufc".includes(surface)) wildGround(g,surface,x,y,rand,detail);
    else if(surface==="d" || timber && "hobA+=".includes(c)) wood(g,x,y,rand,detail);
    else if(surface==="," || outdoor && "trbo".includes(c)) grass(g,x,y,rand,detail);
    else if(surface===":" || c==="h" && !timber) sand(g,x,y,rand,detail);
    else stoneFloor(g,x,y,rand,detail);
    // Sombra ao pé das paredes, sem avançar sobre casas vizinhas.
    if(wall(at(rows,x,y-1))) {g.fillStyle=gradient(g,"#07111988","#07111900",0,0,0,22);g.fillRect(0,0,100,22);}
    if(wall(at(rows,x-1,y))) {g.fillStyle=gradient(g,"#07111955","#07111900",0,0,15,0);g.fillRect(0,0,15,100);}
    if(c==="t") tree(g,rand,detail);
    if(c==="h") furniture(g,rows,x,y,timber,rand,detail);
    if(c==="o") pillar(g);
    if(c==="A") altar(g,rows,x,y);
    if(c==="b") brazier(g);
    if(c==="+") door(g,rows,x,y);
    if("paCPjw".includes(c)) vegetation(g,c,rand);
    if("gONY".includes(c)) monument(g,c);
    if("HFqEM".includes(c)) building(g,c,rows,x,y);
    if("Bk".includes(c)) treasure(g,c);
    if(c==="R") rock(g,48,49,44,rand,15,["#a5a38e","#46585a","#bbc1ab"]);
    if(c==="i" || c==="X") for(let i=0;i<3;i++) {
      const xx=25+i*23,yy=24+rand(i+10)*30;
      shape(g,[[xx,yy],[xx+14,yy+20],[xx+12,83],[xx-9,78],[xx-10,yy+20]],gradient(g,c==="X"?"#87d7ca":"#b8a993",c==="X"?"#355b70":"#555c56"),"#293d43",1.3);
      line(g,[[xx,yy],[xx+2,76]],c==="X"?"#dcfff1aa":"#d5c7a866",1.5);
    }
    if(c==="r") for(let i=0;i<6;i++) rock(g,15+rand(i+10)*70,16+rand(i+20)*67,6+rand(i+30)*12,rand,i*12,["#9c9b80","#4d5d53","#aaac91"]);
    if(c==="=") for(let i=0;i<5;i++) {
      const yy=i*20;g.fillStyle=gradient(g,"#9b9981","#566258",0,yy,0,yy+16);g.fillRect(0,yy,100,16);
      line(g,[[0,yy+2],[100,yy+2]],"#d2c6a26b",1.5);line(g,[[0,yy+18],[100,yy+18]],"#1e312e",3);
    }
    if(c==="S") {
      // Marcas de canto indicam a entrada sem substituir o terreno.
      for(let i=0;i<4;i++){g.save();g.translate(50,50);g.rotate(i*Math.PI/2);line(g,[[-24,-32],[-32,-32],[-32,-24]],"#ddc58b66",1.5);g.restore();}
    }
  }
  if(c==="T") {
    shape(g,[[41,76],[44,43],[53,39],[58,46],[55,80]],"#282f2b","#afa078",2);
    line(g,[[48,76],[50,53]],"#95683c",6);
    shape(g,[[39,49],[60,49],[56,61],[44,61]],"#4a4b37","#c6a970",1.5);
  }
  g.restore();
}
