import*as f from"node:fs";
let w,g,G,B,P,O;
function parse(t){
w=t.indexOf("\n");g=t.replace(/\n/g,"");G=[];B=[];
for(let i=0;i<g.length;i++){let c=g[i];
if(".*+".includes(c))G.push(i);
if("$*".includes(c))B.push(i);
if("@+".includes(c))P=i;}
O=[-w,w,-1,1];
}
function flood(C,p){
let v=[],q=[p];
v[p]=p;
for(let i=0;i<q.length;i++){let s=q[i];
for(let k=0;k<4;k++){let t=s+O[k];
if(g[t]!="#"&&!C[t]&&v[t]==null){v[t]=s;q.push(t);}}}
return[Math.min(...q),v];
}
function solve(A,B,p,C){
let V=[],Q=A.slice();
for(let x of A)V[x]=1;
for(let i=0;i<Q.length;i++){let x=Q[i];
for(let d of O){let y=x-d;
if(g[y]!="#"&&g[y-d]!="#"&&!V[y]){V[y]=1;Q.push(y);}}}
if(B.some(b=>!V[b]))return null;
let S=new Set(),H=[{b:B,m:"",p}];
S.add(B.join()+"|"+flood(C,p)[0]);
for(let h=0;h<H.length&&h<2e5;h++){
let s=H[h];
for(let x of s.b)C[x]=1;
let[l,v]=flood(C,s.p);
for(let i=0;i<s.b.length;i++){
let b=s.b[i];
for(let k=0;k<4;k++){let d=O[k],t=b+d;
if(v[b-d]==null||g[t]=="#"||C[t]||!V[t])continue;
C[b]=0;C[t]=1;
let nb=s.b.slice();nb[i]=t;nb.sort((a,b)=>a-b);
let nk=nb.join()+"|"+flood(C,b)[0];
C[t]=0;C[b]=1;
if(S.has(nk))continue;
S.add(nk);
let m=s.m,o="",q=b-d;
while(q!=s.p){let r=v[q],e=q-r;o="udlr"[O.indexOf(e)]+o;q=r;}
m+=o+"udlr"[k];
if(nb.every(x=>A.includes(x))){for(let x of s.b)C[x]=0;return[m,b];}
H.push({b:nb,m,p:b});
}
}
for(let x of s.b)C[x]=0;
}
return null;
}
function rooms(){
let row=P/w|0,part=[],R=[];
for(let s=0;s<g.length;s++){
if(g[s]=="#"||(s/w|0)==row||part[s]!=null)continue;
let q=[s];part[s]=R.length;
for(let i=0;i<q.length;i++)for(let k=0;k<4;k++){let t=q[i]+O[k];
if(g[t]!="#"&&(t/w|0)!=row&&part[t]==null){part[t]=R.length;q.push(t);}}
R.push({b:[],g:[]});
}
for(let b of B)R[part[b]].b.push(b);
for(let x of G)if(part[x]!=null)R[part[x]].g.push(x);
if(G.some(x=>part[x]==null)||R.some(r=>r.b.length!=r.g.length))return null;
return R.filter(r=>r.b.length);
}
let I=process.env.MAKEFUN_INPUT_DIR||"/input",U=process.env.MAKEFUN_OUTPUT_DIR||"/output";
for(let k=1;k<6;k++){
let id="i00"+k;
parse(f.readFileSync(I+"/"+id+"/level.txt","utf8"));
let C=[],m="",p=P;
for(let x of B)C[x]=1;
let R=rooms()||[{g:G,b:B}],s;
for(let r of R){s=solve(r.g,r.b,p,C)||["",p];m+=s[0];p=s[1];
for(let x of r.b)C[x]=0;for(let x of r.g)C[x]=1;}
f.mkdirSync(U+"/"+id,{recursive:!0});
f.writeFileSync(U+"/"+id+"/solution.txt",m);
}