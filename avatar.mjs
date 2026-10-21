import { SKINS } from './core.mjs?v=2';

// One character renderer for the rope, wardrobe previews and the profile portrait.
export function drawClimber(ctx, { x, y, zoom = 1, skinId = 'worker', equipment, helmet = true, time = 0, washing = false }) {
  const skin = SKINS.find(item => item.id === skinId) || SKINS[0];
  const rect = (x, y, w, h, color, radius = 0) => { ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(x, y, w, h, radius); ctx.fill(); };
  const circle = (x, y, r, color) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); };
  const line = (points, color, width = 3) => { ctx.beginPath(); points.forEach(([x,y],i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y)); ctx.strokeStyle=color; ctx.lineWidth=width; ctx.lineCap='round'; ctx.lineJoin='round'; ctx.stroke(); };
  ctx.save(); ctx.translate(x,y); ctx.scale(zoom,zoom);
  if (skinId === 'foam') {
    ctx.fillStyle = '#f4d57d'; ctx.beginPath(); ctx.moveTo(-13,-7); ctx.quadraticCurveTo(-49,8,-42 + Math.sin(time*3)*5,53); ctx.lineTo(-13,42); ctx.lineTo(13,49); ctx.lineTo(13,-7); ctx.fill();
    circle(-30,29,7,'#fff3bc'); circle(-30,29,3,'#75cdbf');
  }
  line([[-8,22],[-18,42],[-5,51]],skin.trousers,12); line([[9,22],[19,37],[27,48]],skin.trousers,12);
  line([[-8,51],[2,52]],'#173f3d',9); line([[23,48],[33,48]],'#173f3d',9);
  rect(-16,-8,32,37,skin.jacket,9); rect(-16,3,32,5,skin.trim,1);
  line([[-11,-4],[-3,22],[10,-4]],'#31524a',4); line([[-15,23],[15,23]],'#31524a',5); circle(0,22,4,'#e4e6b3');
  line([[-13,0],[-28,7],[-31,-10]],skin.jacket,9); line([[13,0],[25,-13],[13,-26]],skin.jacket,9);
  circle(13,-27,5,'#f3c897'); circle(-31,-12,5,'#f3c897');
  circle(0,-20,12,'#f0c38e'); rect(-12,-26,8,10,'#654b3c',3);
  circle(6,-21,1.6,'#294b42'); line([[7,-14],[3,-13]],'#996a4e',1.3);
  if (skinId === 'neon') { rect(-4,-26,17,9,'#173f51',3); line([[1,-23],[8,-23]],'#94ffe8',2); }
  if (helmet) {
    ctx.fillStyle=skin.helmet; ctx.beginPath(); ctx.arc(0,-26,15,Math.PI,0); ctx.fill(); rect(-17,-28,35,5,skin.trim,2);
    line([[0,-40],[0,-30]],skin.jacket,2);
    if (equipment.helmetLevel >= 2) { circle(3,-33,4,'#e7f6cd'); circle(3,-33,2,'#75c8b5'); }
    if (equipment.helmetLevel === 3) line([[-12,-37],[-12,-31]],'#fdfce3',3);
  }
  line([[-24,21],[-27,10],[-35,10],[-38,22]],'#c4cfb1',2); rect(-42,19,21,23,skin.bucket,4); rect(-44,18,25,5,skin.trim,2);
  const width = 26 + equipment.squeegeeLevel * 10;
  line([[13,-25],[13,-38]],'#b88a51',4); rect(13-width/2,-42,width,7,skinId === 'neon' ? '#9effe6' : '#375b53',2);
  if (washing) for (let j=0;j<6;j++) circle(13-width/2+3+j*(width-6)/5,-43,3+(j%2),'#eef9e9');
  if (skinId === 'foam') { circle(-37,-11,4,'#dafbf0'); circle(-44,-21,2.5,'#f1ffee'); }
  ctx.restore();
}
