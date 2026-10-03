import { CATALOG, PARAMETER_DEFS, DEFAULT_APPEARANCE } from './catalog.js';
export const STORAGE_KEY = 'dots-fur-studio:v2';
const validId = (category, value, fallback) => CATALOG[category].some(item=>item.id===value) ? value : fallback;
export function normalizeHexColor(value) {
 if(typeof value!=='string')return null;
 const hex=value.trim().toLowerCase();
 if(/^#[0-9a-f]{6}$/.test(hex))return hex;
 if(/^#[0-9a-f]{3}$/.test(hex))return '#'+[...hex.slice(1)].map(c=>c+c).join('');
 return null;
}
export function resolveBodyColor(value) {
 return normalizeHexColor(value)
  ?? CATALOG.colors.find(item=>item.id===value)?.hex
  ?? CATALOG.colors.find(item=>item.id===DEFAULT_APPEARANCE.color).hex;
}
export function normalizeAccessoryColors(raw) {
 const colors={};
 if(!raw || typeof raw!=='object' || Array.isArray(raw))return colors;
 for(const {id} of CATALOG.accessories){
  if(!Object.hasOwn(raw,id))continue;
  const color=normalizeHexColor(raw[id]);
  if(color)colors[id]=color;
 }
 return colors;
}
export function normalizeAppearance(raw={}) {
 const a=raw && typeof raw==='object' ? raw : {};
 const accessories=[];
 for(const id of Array.isArray(a.accessories)?a.accessories:[]) {
  const item=CATALOG.accessories.find(x=>x.id===id);
  if(!item)continue;
  const occupied=accessories.findIndex(x=>CATALOG.accessories.find(y=>y.id===x).slot===item.slot);
  if(occupied>=0)accessories.splice(occupied,1);
  accessories.splice(0,accessories.length,id);
 }
 const shape=validId('shapes',a.shape,DEFAULT_APPEARANCE.shape);
 const candidateEyes=validId('eyes',a.eyes,DEFAULT_APPEARANCE.eyes);
 const eyes=shape==='rounded_head_two_ears'?'round_inset':candidateEyes==='round_inset'?'oval':candidateEyes;
 return {shape,color:normalizeHexColor(a.color)??validId('colors',a.color,DEFAULT_APPEARANCE.color),eyes,eyewear:validId('eyewear',a.eyewear,'none'),accessories:['rounded_head_two_ears','circle_two_ears'].includes(shape)?accessories.filter(id=>['headphones','bow'].includes(id)):accessories,accessoryColors:normalizeAccessoryColors(a.accessoryColors),name:typeof a.name==='string'?a.name.trim().slice(0,30)||'番薯':'番薯'};
}
export function normalizeParameters(raw={}) {
 return Object.fromEntries(PARAMETER_DEFS.map(p=>[p.id,typeof raw?.[p.id]==='number'&&Number.isFinite(raw[p.id])?Math.min(p.max,Math.max(p.min,raw[p.id])):p.default]));
}
export function loadSettings() {
 try {const saved=JSON.parse(localStorage.getItem(STORAGE_KEY));if(saved?.version!==2)return null;return {appearance:normalizeAppearance(saved.appearance),parameters:normalizeParameters(saved.parameters),quality:['auto','low','medium','high'].includes(saved.quality)?saved.quality:'auto'};}catch{return null;}
}
export function saveSettings(settings) {localStorage.setItem(STORAGE_KEY,JSON.stringify({version:2,...settings}));}
