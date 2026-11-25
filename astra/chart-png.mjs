// Minimal dependency-free candlestick renderer -> PNG data URL. Used for vision
// capability tests and to show research-lab prefixes to vision models exactly as
// a trader would see them (future candles are never passed in).
import zlib from 'node:zlib';

const CRC=new Int32Array(256).map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c;});
function crc32(buf){let c=-1;for(const b of buf)c=CRC[(c^b)&255]^(c>>>8);return (c^-1)>>>0;}
function chunk(type,data){const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const td=Buffer.concat([Buffer.from(type),data]);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(td));return Buffer.concat([len,td,crc]);}

/** bars: [{o,h,l,c}] oldest first. Returns 'data:image/png;base64,...'. */
export function candlesPng(bars,{width=720,height=400,marks=[]}={}){
  const px=Buffer.alloc(width*height*3,0xff);
  const set=(x,y,[r,g,b])=>{if(x<0||y<0||x>=width||y>=height)return;const i=(y*width+x)*3;px[i]=r;px[i+1]=g;px[i+2]=b;};
  const hi=Math.max(...bars.map(b=>b.h)),lo=Math.min(...bars.map(b=>b.l)),pad=(hi-lo)*0.06||1;
  const top=hi+pad,bot=lo-pad,Y=p=>Math.round((top-p)/(top-bot)*(height-1));
  const slot=(width-20)/bars.length,bw=Math.max(1,Math.floor(slot*0.6));
  for(let g=1;g<5;g++){const y=Math.round(g*height/5);for(let x=0;x<width;x+=3)set(x,y,[225,229,236]);}
  bars.forEach((b,i)=>{
    const cx=Math.round(10+i*slot+slot/2),up=b.c>=b.o,col=up?[22,163,107]:[214,52,71];
    for(let y=Y(b.h);y<=Y(b.l);y++)set(cx,y,col);
    const y0=Y(Math.max(b.o,b.c)),y1=Math.max(Y(Math.min(b.o,b.c)),y0+1);
    for(let y=y0;y<=y1;y++)for(let x=cx-Math.floor(bw/2);x<=cx+Math.floor(bw/2);x++)set(x,y,col);
  });
  for(const m of marks){const y=Y(m.price);for(let x=0;x<width;x+=2)set(x,y,m.color||[37,99,235]);}
  const raw=Buffer.alloc((width*3+1)*height);
  for(let y=0;y<height;y++){raw[y*(width*3+1)]=0;px.copy(raw,y*(width*3+1)+1,y*width*3,(y+1)*width*3);}
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=2;ihdr[10]=0;ihdr[11]=0;ihdr[12]=0;
  const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
  return 'data:image/png;base64,'+png.toString('base64');
}

/** A synthetic, unambiguous chart for the vision capability test: steady decline then a sharp V recovery. */
export function visionTestChart(){
  const bars=[];let p=100;
  for(let i=0;i<26;i++){const o=p;p-=1.1+((i*7)%3)*0.2;bars.push({o,h:o+0.4,l:p-0.4,c:p});}
  for(let i=0;i<8;i++){const o=p;p+=3.2;bars.push({o,h:p+0.5,l:o-0.3,c:p});}
  return {image:candlesPng(bars),expected:{priorTrend:'DOWN',lastMoveDirection:'UP'}};
}
