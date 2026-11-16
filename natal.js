// Moteur de thème natal partagé (Node pour tests, navigateur pour l'app)
function makeNatal(A){
  const SIGNS=['Bélier','Taureau','Gémeaux','Cancer','Lion','Vierge','Balance','Scorpion','Sagittaire','Capricorne','Verseau','Poissons'];
  const norm=x=>((x%360)+360)%360, rad=Math.PI/180;
  const BODIES=[['Sun','Soleil'],['Moon','Lune'],['Mercury','Mercure'],['Venus','Vénus'],['Mars','Mars'],['Jupiter','Jupiter'],['Saturn','Saturne'],['Uranus','Uranus'],['Neptune','Neptune'],['Pluto','Pluton']];
  function lon(b,t){if(b==='Sun')return A.SunPosition(t).elon;if(b==='Moon')return A.EclipticGeoMoon(t).lon;return A.Ecliptic(A.GeoVector(b,t,true)).elon}
  function speed(b,t){let d=lon(b,t.AddDays(.02))-lon(b,t.AddDays(-.02));if(d>180)d-=360;if(d<-180)d+=360;return d/.04}
  function angles(t,lat,lonE){const st=A.SiderealTime(t);const ramc=norm(st*15+lonE)*rad;const eps=A.e_tilt(t).tobl*rad,phi=lat*rad;
    const mc=norm(Math.atan2(Math.sin(ramc),Math.cos(ramc)*Math.cos(eps))/rad);
    const asc=norm(Math.atan2(Math.cos(ramc),-(Math.sin(ramc)*Math.cos(eps)+Math.tan(phi)*Math.sin(eps)))/rad);
    return {asc,mc}}
  function meanNode(t){const T=t.tt/36525;return norm(125.04452-1934.136261*T+0.0020708*T*T)}
  function chart(utcDate,lat,lonE){const t=A.MakeTime(utcDate);const pts=BODIES.map(([b,fr])=>({id:b,name:fr,lon:lon(b,t),retro:b!=='Sun'&&b!=='Moon'&&speed(b,t)<0}));const {asc,mc}=angles(t,lat,lonE);
    pts.push({id:'Node',name:'Nœud Nord',lon:meanNode(t)},{id:'Asc',name:'Ascendant',lon:asc},{id:'MC',name:'Milieu du Ciel',lon:mc});return pts}
  const fmtPos=l=>{const s=Math.floor(norm(l)/30),d=norm(l)-s*30;let deg=Math.floor(d),min=Math.round((d-deg)*60);if(min===60){deg++;min=0}return {sign:SIGNS[s],deg,min}};
  function transitLongs(date){const t=A.MakeTime(date);return BODIES.filter(([b])=>b!=='Moon').map(([b,fr])=>({id:b,name:fr,lon:lon(b,t),retro:b!=='Sun'&&speed(b,t)<0}))}
  return {chart,fmtPos,transitLongs,SIGNS,norm};
}
if(typeof module!=='undefined')module.exports=makeNatal;
