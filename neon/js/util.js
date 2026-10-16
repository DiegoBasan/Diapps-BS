/* Utilidades: hash entero determinista (misma ciudad en cada visita), RNG con semilla y ruido. */
import {SimplexNoise} from "../../shared/vendor/three/math/SimplexNoise.js";

export const SEED=1337;

/* hash de 2 enteros + canal -> [0,1) */
export function hash2(x,y,s=0){
  let h=(Math.imul(x|0,374761393)+Math.imul(y|0,668265263)+Math.imul(s|0,982451653)+SEED)|0;
  h=Math.imul(h^(h>>>13),1274126177);h^=h>>>16;
  return (h>>>0)/4294967296;
}

/* mulberry32 */
export function rng(seed){
  let a=seed>>>0;
  return ()=>{a=(a+0x6D2B79F5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return ((t^(t>>>14))>>>0)/4294967296};
}

export const noise=new SimplexNoise({random:rng(SEED)});

export const clamp=(v,a,b)=>v<a?a:v>b?b:v;
export const lerp=(a,b,t)=>a+(b-a)*t;
export const smooth=(a,b,t)=>{t=clamp((t-a)/(b-a),0,1);return t*t*(3-2*t)};
/* suavizado independiente del framerate */
export const damp=(a,b,k,dt)=>a+(b-a)*(1-Math.exp(-k*dt));
export const pick=(arr,r)=>arr[Math.min(arr.length-1,Math.floor(r*arr.length))];

export const isTouch=matchMedia("(pointer:coarse)").matches||"ontouchstart" in window;
export const isMobile=isTouch&&Math.min(screen.width,screen.height)<900;
