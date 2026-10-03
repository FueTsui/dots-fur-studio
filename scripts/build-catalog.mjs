import fs from 'node:fs/promises';
const categories=['shapes','colors','eyes','eyewear','accessories'];
const raw=JSON.parse(await fs.readFile('output/original-dots/catalog.json','utf8'));
const labels=[['圆形','圆角三角','胶囊','双耳圆头','六瓣花','爱心','四瓣蝴蝶','圆形双耳','十二瓣花','圆角六边形','圆角菱形'],['粉红','兰紫','紫罗兰','蓝色','天蓝','青绿','青柠','黄色','珊瑚'],['飞扬眼睫','椭圆眼','星星眼','胶囊高光','豆豆眼','圆形高光','圆形内嵌','月牙内嵌','困困眼'],['无眼镜','单片眼镜','椭圆镜框','方形墨镜','经典墨镜','圆形墨镜'],['耳机','领结','针织帽','礼帽','贝雷帽','圆球','三瓣发饰','皇冠']];
const catalog={};
for(let i=0;i<categories.length;i++){
 const category=categories[i];catalog[category]=[];
 for(let j=0;j<raw[i].length;j++){
  const item=raw[i][j]; const record={id:item.id,title:item.title,label:labels[i][j],slot:item.slot};
  if(item.thumbnail){const target=`public/orbit/thumbnails/${category}/${item.id}.png`;await fs.mkdir(`public/orbit/thumbnails/${category}`,{recursive:true});await fs.copyFile(`output/original-dots/${item.thumbnail}`,target);record.thumbnail=`/orbit/thumbnails/${category}/${item.id}.png`;}
  if(category==='colors')record.hex='#'+[item.red,item.green,item.blue].map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join('');
  catalog[category].push(record);
 }
}
const parameters=[
 ['length','毛发长度',.035,.22,.005,.1,'从表面伸出的长度，增大后呈现长毛。'],
 ['density','毛发密度',35,180,5,125,'目标毛发数量，单位千根；画质会限制实际数量。'],
 ['thickness','毛发粗细',.15,.85,.01,.46,'单根毛发的宽度，越高越厚实。'],
 ['mess','杂乱程度',0,2,.05,1.1,'毛发方向的随机偏移，越高越蓬乱。'],
 ['curl','卷曲程度',0,3,.05,1.6,'毛发弯曲与卷曲幅度。'],
 ['gravity','下垂程度',0,1.5,.05,.45,'向下弯曲的力度，越高越垂顺。'],
 ['bright','毛绒亮度',.6,1.6,.05,1,'毛绒材质的整体明亮度。'],
 ['rim','轮廓光',0,1.8,.05,.85,'角色边缘的补光强度。'],
].map(([id,label,min,max,step,defaultValue,description])=>({id,label,min,max,step,default:defaultValue,description}));
await fs.writeFile('src/catalog.js',`// Original catalog and thumbnails extracted from the user-supplied Dots renderer.\nexport const CATALOG = ${JSON.stringify(catalog,null,2)};\nexport const PARAMETER_DEFS = ${JSON.stringify(parameters,null,2)};\nexport const DEFAULT_APPEARANCE = Object.freeze({shape:'rounded_triangle',color:'pink',eyes:'oval',eyewear:'none',accessories:[],name:'番薯'});\n`);
await fs.writeFile('public/orbit/catalog.json',JSON.stringify(catalog,null,2));
console.log('Catalog and 34 original thumbnails copied.');
