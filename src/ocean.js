import * as THREE from "three";
import { createSpectralOcean } from "./spectral-ocean.js";
import { createCapillaryOcean } from "./capillary-ocean.js";
import { createCpuCapillaryOcean } from "./cpu-capillary-ocean.js";
import { createAtmosphere } from "./atmosphere.js";
import {
  PREFILTER_GLSL,
  installPrefilterUniforms,
} from "./prefiltered-environment.js";
import { createOceanMotion } from "./ocean-motion.js";
import { createSeabed } from "./seabed.js";
import {
  PHOTO_SKY_GLSL,
  installPhotoSkyUniforms,
  loadPhotoSky,
} from "./photo-sky.js";
import {
  REFRACTION_GLSL,
  installRefractionUniforms,
  createRefractionPass,
} from "./refraction.js";
const $ = (id) => document.getElementById(id);
const shaderCommon = `
uniform float uTime,uWave,uWind,uSun,uMood,uDetail,uSpectral,uEnvironmentReady,uEnvironmentMix,uSkySun,uSkyMood,uEnvironmentSizeA,uEnvironmentSizeB,uGridRadialStep,uGridAngularStep,uEnvironmentIntensity,uSpectralSize,uSkyReflectionBlur,uFoamScale;
uniform vec2 uFoamAnchor;
uniform samplerCube uEnvironmentA,uEnvironmentB;uniform vec3 uSolarColor;
${PREFILTER_GLSL}
uniform sampler2D uFieldLarge,uFieldSmall,uFieldFine,uNormalLarge,uNormalSmall,uNormalFine;
const float PI=3.14159265359;
float hash(vec2 p){
 uvec2 q=uvec2(ivec2(floor(p)));
 uint h=q.x*0x9e3779b9u+q.y*0x85ebca6bu;
 h^=h>>16;h*=0x7feb352du;h^=h>>15;h*=0x846ca68bu;h^=h>>16;
 return (float(h>>9)+.5)*(1./8388608.);
}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*noise(p);p=mat2(.8,.6,-.6,.8)*p*2.03;a*=.5;}return v;}
vec2 foamFilteredBreakup(vec2 p,float footprint){
 float mean=0.,variance=0.,amplitude=.5;
 for(int i=0;i<4;i++){
  float weight=clamp((exp(-.55*footprint*footprint)-.01)/.99,0.,1.);
  float n=.5;if(weight>0.)n=noise(p);
  mean+=amplitude*mix(.5,n,weight);
  variance+=amplitude*amplitude*.045987*(1.-weight*weight);
  p=mat2(.8,.6,-.6,.8)*p*2.03;footprint*=2.03;amplitude*=.5;
 }
 return vec2(mean,variance);
}
float foamOptical(float a,float value){return 1.-exp(-a*smoothstep(.20,.60,value));}
float foamFilteredOptical(vec2 breakup,float a){
 float sigma=sqrt(breakup.y);
 return .53333333*foamOptical(a,breakup.x)+.22207592*(foamOptical(a,breakup.x-1.35562618*sigma)+foamOptical(a,breakup.x+1.35562618*sigma))+.01125741*(foamOptical(a,breakup.x-2.85697001*sigma)+foamOptical(a,breakup.x+2.85697001*sigma));
}
float foamLaceAverage(float wall){float r2=wall*wall;return 1.-PI*(r2+.001125)+(15.-14.2*wall)*r2*r2*r2;}
uint foamHashBits(uint h){h^=h>>16;h*=0x7feb352du;h^=h>>15;h*=0x846ca68bu;h^=h>>16;return h;}
float foamMark(vec2 cell,uint salt){uvec2 q=uvec2(ivec2(cell));uint h=foamHashBits(q.x*0x9e3779b9u^q.y*0x85ebca6bu^salt);return(float(h>>9)+.5)*(1./8388608.);}
float foamFilteredLace(vec2 uv,float footprint,float wall){
 float mean=clamp(foamLaceAverage(wall),.08,.96);
 float fade=1.-smoothstep(.2,1.4,footprint*2.2);
 if(fade<=0.)return mean;
 const float density=1.4944508;
 float radius=sqrt(-log(mean)/(PI*density));
 vec2 p=uv*2.2+vec2(fbm(uv*.91),fbm(uv*.97+vec2(17.3,41.8)))*1.15,cell=floor(p),f=fract(p);
 float width=min(sqrt(.045*.045+pow(footprint*2.2*.65,2.)),.24);
 float nearest=2.;
 for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
  vec2 offset=vec2(float(x),float(y)),id=cell+offset;
  float countSeed=foamMark(id,0x73ac29b1u);
  int count=countSeed<.22313016?0:countSeed<.55782540?1:countSeed<.80884683?2:countSeed<.93435755?3:countSeed<.98142406?4:5;
  for(int j=0;j<5;j++){
   if(j>=count)break;
   uint salt=uint(j)*0x4cf5ad43u;
   vec2 center=vec2(foamMark(id,salt^0x12de6a91u),foamMark(id,salt^0x783fa711u));
   float scale=exp(mix(-.7,.7,foamMark(id,salt^0xb491c3d5u)))/1.166258;
   vec2 delta=offset+center-f;float angle=6.2831853*foamMark(id,salt^0x913bc72du);float eccentricity=exp(mix(-.52,.52,foamMark(id,salt^0xadd17253u)));vec2 axis=vec2(cos(angle),sin(angle));
   vec2 local=vec2(dot(delta,axis),dot(delta,vec2(-axis.y,axis.x)))*vec2(eccentricity,1./eccentricity);
   float d=length(local)-radius*scale;
   nearest=min(nearest,d);
  }
 }
 return mix(mean,smoothstep(-width,width,nearest),fade);
}

float activeSun(){return mix(uSun,uSkySun,uEnvironmentReady);}
float activeMood(){return mix(uMood,uSkyMood,uEnvironmentReady);}
vec3 sunDir(){float elevation=activeSun();return vec3(-.79863551*cos(elevation),sin(elevation),-.60181502*cos(elevation));}
float storminess(){return max(activeMood()-1.,0.);}
vec3 sunlight(){if(uEnvironmentReady>.5)return uSolarColor;return mix(vec3(1.,.49,.18),vec3(1.,.90,.71),smoothstep(.09,.65,uSun));}
vec3 horizonColor(){return mix(mix(vec3(.30,.185,.085),vec3(.30,.51,.67),min(activeMood(),1.)),vec3(.23,.29,.33),storminess());}
vec4 environmentSample(vec3 direction,float lod){
 if(uEnvironmentMix>.999)return textureLod(uEnvironmentB,direction,lod);
 vec4 a=textureLod(uEnvironmentA,direction,lod);if(uEnvironmentMix<.001)return a;
 return mix(a,textureLod(uEnvironmentB,direction,lod),uEnvironmentMix);
}
float sunVisibility(){return uEnvironmentReady>.5?environmentSample(sunDir(),0.).a:1.-storminess()*.985;}
float environmentFresnel(float NoV,float roughness){
 vec4 r=roughness*vec4(-1.,-.0275,-.572,.022)+vec4(1.,.0425,1.04,-.04);
 float a=min(r.x*r.x,exp2(-9.28*NoV))*r.x+r.y;vec2 brdf=vec2(-1.04,1.04)*a+r.zw;
 return clamp(.0180094*brdf.x+brdf.y,0.,1.);
}
vec3 rawEnvironmentDiffuse(){
 float lodA=max(log2(max(uEnvironmentSizeA,1.))-1.,0.),lodB=max(log2(max(uEnvironmentSizeB,1.))-1.,0.);
 if(uEnvironmentMix>.999)return textureLod(uEnvironmentB,vec3(0,1,0),lodB).rgb;
 vec3 a=textureLod(uEnvironmentA,vec3(0,1,0),lodA).rgb;if(uEnvironmentMix<.001)return a;
 return mix(a,textureLod(uEnvironmentB,vec3(0,1,0),lodB).rgb,uEnvironmentMix);
}
vec3 rawEnvironmentReflection(vec3 direction,float roughness){
 float lodA=clamp(log2(max(roughness*roughness*uEnvironmentSizeA,1.)),0.,8.),lodB=clamp(log2(max(roughness*roughness*uEnvironmentSizeB,1.)),0.,8.);
 if(uEnvironmentMix>.999)return textureLod(uEnvironmentB,direction,lodB).rgb;
 vec3 a=textureLod(uEnvironmentA,direction,lodA).rgb;if(uEnvironmentMix<.001)return a;
 return mix(a,textureLod(uEnvironmentB,direction,lodB).rgb,uEnvironmentMix);
}
vec3 environmentReflection(vec3 direction,float roughness){
 if(uPrefilterReady>.5){vec3 filtered=prefilteredEnvironment(direction,roughness);if(roughness>.10)return filtered*uEnvironmentIntensity;return mix(rawEnvironmentReflection(direction,roughness),filtered,smoothstep(.035,.10,roughness))*uEnvironmentIntensity;}
 return rawEnvironmentReflection(direction,roughness)*uEnvironmentIntensity;
}
vec3 environmentDiffuse(){
 if(uPrefilterReady>.5)return prefilteredEnvironment(vec3(0,1,0),1.)*uEnvironmentIntensity;
 return rawEnvironmentDiffuse()*uEnvironmentIntensity;
}
vec3 sky(vec3 rd,bool disc){
 if(uEnvironmentReady>.5){vec4 environment=environmentSample(normalize(rd),0.);if(disc)environment.rgb+=sunlight()*4.5*smoothstep(.999955,.999985,dot(normalize(rd),sunDir()))*environment.a;return environment.rgb;}
 float y=max(rd.y,0.);float s=max(dot(rd,sunDir()),0.);float storm=storminess();
 vec3 zenith=mix(mix(vec3(.018,.075,.19),vec3(.025,.18,.38),min(activeMood(),1.)),vec3(.049,.075,.099),storm);
 vec3 c=mix(horizonColor(),zenith,pow(y,.27));
 float day=smoothstep(.12,.8,uSun);c=mix(c,c*1.3,day);
 c+=sunlight()*pow(s,9.)*.10*(1.-storm*.75);
 c+=sunlight()*pow(s,120.)*.27*(1.-storm*.65);
 if(disc){c+=sunlight()*pow(s,1500.)*.48*(1.-storm*.80);c+=sunlight()*24.*smoothstep(.999955,.999985,s)*(1.-storm*.985);}
 vec2 cp=rd.xz/(y+.12)*1.25+vec2(uTime*.0025,.0);
 float layer=fbm(cp*vec2(.7,1.6));
 float cover=smoothstep(mix(.56,.37,storm),mix(.79,.69,storm),layer)*smoothstep(0.,.1,y);
 vec3 cloud=mix(vec3(.18,.23,.31),vec3(.13,.18,.22),storm);
 cloud+=sunlight()*pow(s,7.)*.30;
 c=mix(c,cloud,cover*.8);
 return c;
}
vec4 smoothSpectral(sampler2D source,vec2 uv,float domain,float footprint);
float spectralAmplitude(){return uWave*pow(max(5.+12.5*uWind,.1)/15.,.33);}
vec4 cubicWeights(float f){float a=1.-f;return vec4(a*a*a,3.*f*f*f-6.*f*f+4.,-3.*f*f*f+3.*f*f+3.*f+1.,f*f*f)/6.;}
vec4 smoothSpectral(sampler2D source,vec2 uv,float domain,float footprint){
 float lod=max(log2(max(footprint,.0001)/(domain/uSpectralSize)),0.);
 if(uDetail<.5||lod>=.5)return textureLod(source,uv,lod);
 vec2 p=uv*uSpectralSize-.5,base=floor(p),f=fract(p);vec4 wx=cubicWeights(f.x),wy=cubicWeights(f.y);
 vec2 gx=vec2(wx.x+wx.y,wx.z+wx.w),gy=vec2(wy.x+wy.y,wy.z+wy.w);
 vec2 hx=vec2(base.x-1.+wx.y/gx.x,base.x+1.+wx.w/gx.y)+.5;
 vec2 hy=vec2(base.y-1.+wy.y/gy.x,base.y+1.+wy.w/gy.y)+.5;
 vec4 a=textureLod(source,vec2(hx.x,hy.x)/uSpectralSize,0.),b=textureLod(source,vec2(hx.y,hy.x)/uSpectralSize,0.);
 vec4 c=textureLod(source,vec2(hx.x,hy.y)/uSpectralSize,0.),d=textureLod(source,vec2(hx.y,hy.y)/uSpectralSize,0.);
 return mix((a*gx.x+b*gx.y)*gy.x+(c*gx.x+d*gx.y)*gy.y,textureLod(source,uv,lod),smoothstep(0.,.5,lod));
}
vec4 spectralField(vec2 rest,float footprint){
 vec4 a=smoothSpectral(uFieldLarge,rest/1024.+.5,1024.,footprint);
 vec2 q=rest+a.yz;vec4 b=smoothSpectral(uFieldSmall,q/96.+.5,96.,footprint);
 vec4 c=smoothSpectral(uFieldFine,(q+b.yz)/9.+.5,9.,footprint);return a+b+c;
}
vec4 normalAt(sampler2D source,vec2 rest,float domain,float footprint){return textureLod(source,rest/domain+.5,max(log2(max(footprint,.0001)/(domain/uSpectralSize)),0.));}
void spectralSurface(vec2 rest,float footprint,out vec3 normal,out float compression,out float variance){
 vec4 a=normalAt(uNormalLarge,rest,1024.,footprint);vec4 da=smoothSpectral(uFieldLarge,rest/1024.+.5,1024.,footprint);vec2 q=rest+da.yz;
 vec4 b=normalAt(uNormalSmall,q,96.,footprint);vec4 db=smoothSpectral(uFieldSmall,q/96.+.5,96.,footprint);
 vec4 c=normalAt(uNormalFine,q+db.yz,9.,footprint);vec3 na=a.xyz*2.-1.,nb=b.xyz*2.-1.,nc=c.xyz*2.-1.;
 normal=normalize(na+nb+nc-vec3(0,2,0));compression=max(3.-a.a-b.a-c.a,0.);
 variance=clamp(max(1.-length(na),0.)+max(1.-length(nb),0.)+max(1.-length(nc),0.),0.,1.);
}
void foamSurface(vec2 world,float footprint,out vec3 normal,out float compression){
 vec4 a=textureLod(uNormalLarge,world/1024.+.5,0.),b=textureLod(uNormalSmall,world/96.+.5,0.),c=textureLod(uNormalFine,world/9.+.5,0.);
 vec2 slope=(a.xz+b.xz+c.xz)*2.-3.;normal=normalize(vec3(slope.x,1.,slope.y));compression=max(3.-a.a-b.a-c.a,0.);
}
vec3 tonemap(vec3 x){x=max(x,vec3(0));return pow(clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.),vec3(1./2.2));}
`;
const waveFunctions = `
uniform float uWavePhase[7];
void wave(inout vec3 p,inout vec3 tx,inout vec3 tz,inout float variance,vec2 rest,float temporalPhase,vec2 dir,float wavelength,float steep,float phase){
 float k=2.*PI/wavelength;float radius=length(rest-vec2(0,8));float spacing=max((radius+.25)*uGridRadialStep,radius*uGridAngularStep);float lod=1.-smoothstep(.18,.48,spacing/wavelength);float vertical=steep/k*uWave*lod;float horizontal=steep/k*min(uWave,1.04*1.15/max(1.15,.35+uWind))*lod;
 float f=k*dot(dir,rest)-temporalPhase+phase;
 variance+=.5*pow(steep*uWave,2.)*(1.-lod*lod);float sn=sin(f),cs=cos(f);p.xz+=dir*horizontal*cs;p.y+=vertical*sn;
 tx+=vec3(-dir.x*dir.x*k*horizontal*sn,dir.x*k*vertical*cs,-dir.x*dir.y*k*horizontal*sn);
 tz+=vec3(-dir.x*dir.y*k*horizontal*sn,dir.y*k*vertical*cs,-dir.y*dir.y*k*horizontal*sn);
}
void ocean(vec2 rest,out vec3 p,out vec3 normal,out float compression,out float variance){
 variance=0.;p=vec3(rest.x,0,rest.y);vec3 tx=vec3(1,0,0),tz=vec3(0,0,1);
 wave(p,tx,tz,variance,rest,uWavePhase[0],normalize(vec2(.38,.92)),31.,.25,.5);
 wave(p,tx,tz,variance,rest,uWavePhase[1],normalize(vec2(-.14,.99)),17.3,.20,1.7);
 wave(p,tx,tz,variance,rest,uWavePhase[2],normalize(vec2(.73,.69)),9.8,.16,2.9);
 wave(p,tx,tz,variance,rest,uWavePhase[3],normalize(vec2(-.65,.76)),6.1,.10,.3);
 wave(p,tx,tz,variance,rest,uWavePhase[4],normalize(vec2(.21,.98)),3.7,.075,4.2);
 wave(p,tx,tz,variance,rest,uWavePhase[5],normalize(vec2(-.81,-.58)),2.2,.045,2.);
 wave(p,tx,tz,variance,rest,uWavePhase[6],normalize(vec2(.9,.44)),1.37,.025,1.);
 normal=normalize(cross(tz,tx));compression=.5*(tx.x+tz.z-sqrt(pow(tx.x-tz.z,2.)+4.*tx.z*tx.z));
}
`;
const vertex = `${shaderCommon}${waveFunctions}
varying vec3 vWorld,vNormal;varying vec2 vRest;varying vec3 vFoam;varying float vGeomVariance;
void main(){vec3 p,n;float j,variance;
 if(uSpectral>.5){
  float radius=length(position.xz-vec2(0,8));float spacing=max((radius+.25)*uGridRadialStep,radius*uGridAngularStep);
  vec4 field=spectralField(position.xz,spacing);
  p=position+vec3(field.y,field.x,field.z);n=vec3(0,1,0);j=1.;variance=0.;
 }else{ocean(position.xz,p,n,j,variance);}
 float farFade=1.-smoothstep(200.,1200.,length(position.xz-cameraPosition.xz));
 vGeomVariance=uSpectral>.5?0.:mix(.073175*uWave*uWave,variance,farFade*farFade);p=mix(position,p,farFade);vWorld=p;vNormal=normalize(mix(vec3(0,1,0),n,farFade));vRest=position.xz;vFoam=vec3(j,0.,p.y);
 gl_Position=projectionMatrix*viewMatrix*vec4(p,1.);
}`;
const fragment = `${shaderCommon}${REFRACTION_GLSL}
uniform sampler2D uFoamTex,uFoamPattern;uniform float uFoamReady,uFoamPatternReady;
uniform float uRipplePhase[12],uRippleWarpPhase;
uniform vec2 uFoamOffset;
uniform sampler2D uCapillary0,uCapillary1;uniform float uCapillaryReady;
varying vec3 vWorld,vNormal;varying vec2 vRest;varying vec3 vFoam;varying float vGeomVariance;
void main(){
 vec3 V=normalize(cameraPosition-vWorld);float dist=length(cameraPosition-vWorld);
 vec2 p=vRest,ripplePosition=vWorld.xz;vec2 slopes=vec2(0);float amp=.12*(.23+uWind);float freq=mix(2.5,3.8,uSpectral);float unresolved=0.;
 if(uSpectral>.5){
 }else if(uCapillaryReady>1.5){
 float capFootprint=max(length(dFdx(ripplePosition)),length(dFdy(ripplePosition)));
 mat2 rotation0=mat2(.91712082,.39860933,-.39860933,.91712082),rotation1=mat2(.80802751,-.58914476,.58914476,.80802751);
 float lod0=max(log2(max(capFootprint,.0001)/(9.113/64.)),0.);
 float lod1=max(log2(max(capFootprint,.0001)/(2.173/64.)),0.);
 vec4 c0=textureLod(uCapillary0,rotation0*ripplePosition/9.113,lod0),c1=textureLod(uCapillary1,rotation1*ripplePosition/2.173,lod1);
 mat2 rotation2=mat2(.42665981,.90441219,-.90441219,.42665981),rotation3=mat2(-.21745242,-.97607092,.97607092,-.21745242);
 vec4 c2=textureLod(uCapillary0,rotation2*ripplePosition/9.113+vec2(.371,.613),lod0),c3=textureLod(uCapillary1,rotation3*ripplePosition/2.173+vec2(.739,.271),lod1);
 mat2 rotation4=mat2(-0.563985058,0.825784993,-0.825784993,-0.563985058),rotation5=mat2(0.565299531,0.824885713,-0.824885713,0.565299531);
 vec4 c4=textureLod(uCapillary0,rotation4*ripplePosition/9.113+vec2(.173,.887),lod0),c5=textureLod(uCapillary1,rotation5*ripplePosition/2.173+vec2(.483,.129),lod1);
 float scale=amp*1.26*.577350269;
 slopes=(transpose(rotation0)*c0.xy+transpose(rotation1)*c1.xy+transpose(rotation2)*c2.xy+transpose(rotation3)*c3.xy+transpose(rotation4)*c4.xy+transpose(rotation5)*c5.xy)*scale;
 unresolved=(max(c0.z-dot(c0.xy,c0.xy),0.)+max(c1.z-dot(c1.xy,c1.xy),0.)+max(c2.z-dot(c2.xy,c2.xy),0.)+max(c3.z-dot(c3.xy,c3.xy),0.)+max(c4.z-dot(c4.xy,c4.xy),0.)+max(c5.z-dot(c5.xy,c5.xy),0.))*scale*scale+amp*amp*.20;

 }else if(uCapillaryReady>.5){
 float capFootprint=max(length(dFdx(ripplePosition)),length(dFdy(ripplePosition)));
 mat2 rotation0=mat2(.91712082,.39860933,-.39860933,.91712082),rotation1=mat2(.80802751,-.58914476,.58914476,.80802751);
 float lod0=max(log2(max(capFootprint,.0001)/(17.82/256.)),0.);
 float lod1=max(log2(max(capFootprint,.0001)/(2.173/128.)),0.);
 vec4 c0=textureLod(uCapillary0,rotation0*ripplePosition/17.82,lod0),c1=textureLod(uCapillary1,rotation1*ripplePosition/2.173,lod1);
 mat2 rotation2=mat2(.42665981,.90441219,-.90441219,.42665981),rotation3=mat2(-.21745242,-.97607092,.97607092,-.21745242);
 vec4 c2=textureLod(uCapillary0,rotation2*ripplePosition/17.82+vec2(.371,.613),lod0),c3=textureLod(uCapillary1,rotation3*ripplePosition/2.173+vec2(.739,.271),lod1);
 mat2 rotation4=mat2(-0.563985058,0.825784993,-0.825784993,-0.563985058),rotation5=mat2(0.565299531,0.824885713,-0.824885713,0.565299531);
 vec4 c4=textureLod(uCapillary0,rotation4*ripplePosition/17.82+vec2(.173,.887),lod0),c5=textureLod(uCapillary1,rotation5*ripplePosition/2.173+vec2(.483,.129),lod1);
 float scale=amp*1.17*.577350269;
 slopes=(transpose(rotation0)*c0.xy+transpose(rotation1)*c1.xy+transpose(rotation2)*c2.xy+transpose(rotation3)*c3.xy+transpose(rotation4)*c4.xy+transpose(rotation5)*c5.xy)*scale;
 unresolved=(max(c0.z-dot(c0.xy,c0.xy),0.)+max(c1.z-dot(c1.xy,c1.xy),0.)+max(c2.z-dot(c2.xy,c2.xy),0.)+max(c3.z-dot(c3.xy,c3.xy),0.)+max(c4.z-dot(c4.xy,c4.xy),0.)+max(c5.z-dot(c5.xy,c5.xy),0.))*scale*scale+amp*amp*.20;

 }else{
 for(int i=0;i<12;i++){
  if(float(i)>=mix(7.,12.,uDetail)){unresolved+=.5*amp*amp;freq*=1.52;amp*=.82;continue;}
  float fi=float(i);vec2 d=normalize(vec2(sin(fi*2.399+1.),cos(fi*2.399+1.)*.8+.35));
  vec2 perpendicular=vec2(-d.y,d.x);float warpPhase=dot(ripplePosition,perpendicular)*freq*.23+uRippleWarpPhase;
  float phase=dot(ripplePosition,d)*freq-uRipplePhase[i]+1.2*sin(warpPhase);
  vec2 phaseGradient=d+perpendicular*.276*cos(warpPhase);
  float footprint=length(vec2(dFdx(phase),dFdy(phase)));float bandWeight=exp(-.25*footprint*footprint);
  slopes+=phaseGradient*cos(phase)*amp*bandWeight;unresolved+=.5*amp*amp*dot(phaseGradient,phaseGradient)*(1.-bandWeight*bandWeight);freq*=1.52;amp*=.82;
 }
 }
 vec3 surfaceNormal=vNormal;float surfaceCompression=vFoam.x,spectralVariance=0.;if(uSpectral>.5){float footprint=max(length(dFdx(p)),length(dFdy(p)));spectralSurface(p,footprint,surfaceNormal,surfaceCompression,spectralVariance);}
 vec3 N=normalize(surfaceNormal+vec3(-slopes.x,0.,-slopes.y)*surfaceNormal.y);
 N=normalize(N+V*max(.025-dot(N,V),0.));
 vec3 R=normalize(reflect(-V,N));float NoV=max(dot(N,V),.015);
 vec3 L=sunDir(),H=normalize(V+L);float NoH=max(dot(N,H),0.),NoL=max(dot(N,L),0.);
 float variance=max(dot(dFdx(N),dFdx(N)),dot(dFdy(N),dFdy(N)));
 float slopeVariance=unresolved+max(vGeomVariance,0.);float rough=clamp(.018+.8*spectralVariance+.8*(sqrt(1.+slopeVariance)-1.)+.8*sqrt(variance),.018,.8);
 float a2=pow(max(rough,.12),4.);float denom=NoH*NoH*(a2-1.)+1.;float D=a2/(PI*denom*denom);
 float k=pow(max(rough,.12)+1.,2.)*.125;float G=NoV/(NoV*(1.-k)+k)*NoL/(NoL*(1.-k)+k);
 float sunF=.0180094+.9819906*pow(1.-max(dot(V,H),0.),5.);
 float spec=D*G*sunF/(4.*NoV+.04);
 vec3 deep=vec3(.0159963,.0612461,.0998987);
 float crest=smoothstep(-.30,.85,vFoam.z/max(uWave,.1));
 vec3 diffuseSky=uEnvironmentReady>.5?environmentDiffuse():vec3(.12,.20,.30);
 float solarVisibility=sunVisibility();
 vec3 refractionNormal=normalize(mix(surfaceNormal,N,.22));refractionNormal=normalize(refractionNormal+V*max(.025-dot(refractionNormal,V),0.));
 float opticalPath,refractionValid;vec3 bottom=transmittedScene(vWorld,refractionNormal,V,opticalPath,refractionValid);
 vec3 sigma=vec3(.29613827,.10461648,.09530747);vec3 extinction=exp(-sigma*opticalPath);
 vec3 mediumLight=diffuseSky*.8+sunlight()*solarVisibility*(.12+.18*NoL);
 vec3 water=bottom*extinction*refractionValid+deep*mediumLight*(1.-extinction*refractionValid);
 vec3 transmissionTint=vec3(.0159963,.1356333,.0908417);
 float backLight=pow(max(dot(V,-normalize(L+N*.4)),0.),2.);float crestTransport=crest*(.12+.6*backLight);
 water+=transmissionTint*crestTransport*(diffuseSky*.4+sunlight()*solarVisibility*2.2);

 vec3 reflected;if(uEnvironmentReady>.5){reflected=environmentReflection(R,min(uSkyReflectionBlur+rough,1.));}else{
 float below=max(-R.y,0.);float bounceF=.0180094+.9819906*pow(1.-min(below,1.),5.);reflected=sky(normalize(vec3(R.x,max(abs(R.y),.002),R.z)),false)*bounceF*(.75+.25*exp(-below*40.))+deep*(1.-bounceF);}
 float integratedF=environmentFresnel(NoV,rough);vec3 color=water*(1.-integratedF)+reflected*integratedF;
 color+=sunlight()*min(spec,22.)*(4.5-storminess()*3.5)*solarVisibility;
 vec2 windDir=vec2(.540302306,.841470985),crossWind=vec2(-windDir.y,windDir.x);
 vec2 foamWorld=vRest,foamCoord=(foamWorld-uFoamAnchor)/400.+.5;
 vec2 edge=1.-smoothstep(vec2(152.),vec2(200.),abs(foamWorld-uFoamAnchor));float foamEdge=edge.x*edge.y;
 vec3 foamN;float compression;if(uSpectral>.5)foamSurface(foamWorld,max(length(dFdx(foamWorld)),length(dFdy(foamWorld))),foamN,compression);else{foamN=surfaceNormal;compression=max(1.-surfaceCompression,0.);}
 float source=.99*smoothstep(.15,.5,compression)+1.10*sqrt(max(dot(foamN.xz,windDir),0.));
 float history=mix(source,texture2D(uFoamTex,clamp(foamCoord,.001,.999)).r*uFoamScale*foamEdge,uFoamReady);
 vec2 breakingUV=(windDir*dot(foamWorld,windDir)*.53+crossWind*dot(foamWorld,crossWind))/9.1;
 float red,surfaceRed;
 if(uFoamPatternReady>.5){red=texture2D(uFoamPattern,breakingUV).r;surfaceRed=texture2D(uFoamPattern,foamWorld/30.).g;}
 else{
  vec2 uv=breakingUV*20.93;float footprint=max(length(dFdx(uv)),length(dFdy(uv)));
  float lace=foamFilteredLace(uv,footprint,.50),micro=foamFilteredLace(uv*5.3+vec2(71.9,-23.7),footprint*5.3,.49);
  red=clamp(.50+.22*lace+.12*micro,0.,1.);
  vec2 surfaceUV=foamWorld*.70;float surfaceFootprint=max(length(dFdx(surfaceUV)),length(dFdy(surfaceUV)));
  surfaceRed=clamp(.45+.37*foamFilteredLace(surfaceUV,surfaceFootprint,.51),0.,1.);
 }
 float threshold=1.-1.6*max(history,0.);float breaking=clamp(red*smoothstep(threshold,threshold+.6,red)*.6,0.,1.);
 float surfaceFoam=surfaceRed*smoothstep(.79,.94,surfaceRed)*.3;
 float foam=clamp(breaking+surfaceFoam,0.,1.);
 color-=sunlight()*min(spec,22.)*(4.5-storminess()*3.5)*solarVisibility*(1.-clamp(1.-2.*foam,0.,1.));
 vec3 foamColor=vec3(.3+.7*clamp(dot(surfaceNormal,L),0.,1.));
 color=mix(color,foamColor,foam);
 if(uRefractionReady>.5){
  vec2 screenUV=gl_FragCoord.xy/uViewport;float rawDepth=texture2D(uSceneDepth,screenUV).r;
  float waterDepth=-(uRefractionView*vec4(vWorld,1.)).z,backgroundDepth=linearEyeDepth(rawDepth);
  if(backgroundDepth>waterDepth&&backgroundDepth<uCameraNearFar.y*.99){
   float thickness=max(backgroundDepth-waterDepth,0.),range=3.95,d=thickness/(range+.001);
   float contactThreshold=mix(1.,d+.23,smoothstep(0.,.3,d));
   float contactRed=uFoamPatternReady>.5?texture2D(uFoamPattern,p/18.).r:red;
   float contact=smoothstep(contactThreshold,contactThreshold+.15,contactRed)*.2;
   float edgeFade=1.-smoothstep(0.,range*.5,thickness);
   color=mix(mix(color,texture2D(uSceneColor,screenUV).rgb,edgeFade),vec3(.846873,.947307,.982251),contact);
  }
 }

 float haze=1.-exp(-pow(dist/mix(280.,220.,storminess()),2.));
 vec3 hazeDirection=normalize(vec3(vWorld.x-cameraPosition.x,dist*.002,vWorld.z-cameraPosition.z));vec3 hazeColor=uEnvironmentReady>.5?environmentSample(hazeDirection,0.).rgb:horizonColor();
 color=mix(color,hazeColor,haze);
 gl_FragColor=vec4(tonemap(color),1.);
}`;
const foamFragment = `${shaderCommon}${waveFunctions}
uniform sampler2D uPreviousFoam;uniform vec2 uFoamDelta;uniform float uSimDt,uFoamQuantized,uFoamResolution;
varying vec2 vUv;
void main(){vec2 world=(vUv-.5)*400.+uFoamAnchor;vec3 n;float compression;
 if(uSpectral>.5)foamSurface(world,400./uFoamResolution,n,compression);
 else{vec3 p;float variance;ocean(world,p,n,compression,variance);compression=max(1.-compression,0.);}
 float source=.99*smoothstep(.15,.5,compression)+1.10*sqrt(max(dot(n.xz,vec2(.540302306,.841470985)),0.));
 vec2 previousUV=vUv+uFoamDelta/400.;float inside=step(0.,previousUV.x)*step(previousUV.x,1.)*step(0.,previousUV.y)*step(previousUV.y,1.);float old=texture2D(uPreviousFoam,clamp(previousUV,0.,1.)).r*uFoamScale*inside,retention=exp(-min(uSimDt,.05)/1.48);
 float history=mix(source,old,retention);
 history/=uFoamScale;history+=step(.000001,uSimDt)*uFoamQuantized*(hash(gl_FragCoord.xy+floor(uTime*60.))-.5)/255.;
 gl_FragColor=vec4(max(history,0.),0.,0.,1.);
}`;
const presets = {
  golden: { wave: 0.9, wind: 0.6, light: 10, mood: 0 },
  azure: { wave: 1, wind: 0.8, light: 50, mood: 1 },
  storm: { wave: 1.45, wind: 0.9, light: 38, mood: 2 },
};
let current = "azure",
  paused = matchMedia("(prefers-reduced-motion: reduce)").matches,
  hidden = false,
  quality = "balanced",
  high = true,
  time = 0;
const qualityProfiles = {
  balanced: { label: "標準", rate: 30, detail: 1 },
  high: { label: "高精細", rate: 60, detail: 1 },
  light: { label: "軽量", rate: 20, detail: 0 },
};
const pixelCap = () =>
  quality === "high"
    ? 1.75
    : quality === "light"
      ? 0.8
      : innerWidth > 700
        ? 1.25
        : 1;
const motion = createOceanMotion();
const uniforms = {
  ...motion.uniforms,
  uSpectralSize: { value: 256 },
  uSkyReflectionBlur: { value: 0.22 },
  uEnvironmentIntensity: { value: 1 },
  uSunDirection: { value: new THREE.Vector3(-0.513, 0.766, -0.387) },
  uSeabedUseSunDirection: { value: 1 },
  uSeabedCaustics: { value: 0.55 },
  uGridRadialStep: { value: Math.log(9601) / 384 },
  uGridAngularStep: { value: (2 * Math.PI) / 512 },
  uTime: { value: 0 },
  uWave: { value: 1 },
  uWind: { value: 0.8 },
  uSun: { value: (50 * Math.PI) / 180 },
  uMood: { value: 1 },
  uDetail: { value: high ? 1 : 0 },
  uFoamPattern: { value: null },
  uFoamPatternReady: { value: 0 },
  uFoamTex: { value: null },
  uFoamAnchor: { value: new THREE.Vector2(0, 0) },
  uFoamScale: { value: 1 },
  uFoamReady: { value: 0 },
  uCapillaryReady: { value: 0 },
  uCapillary0: { value: null },
  uCapillary1: { value: null },
  uSpectral: { value: 0 },
  uFieldLarge: { value: null },
  uFieldSmall: { value: null },
  uFieldFine: { value: null },
  uNormalLarge: { value: null },
  uNormalSmall: { value: null },
  uNormalFine: { value: null },
  uEnvironmentReady: { value: 0 },
  uEnvironmentMix: { value: 1 },
  uEnvironmentSizeA: { value: 256 },
  uEnvironmentSizeB: { value: 256 },
  uEnvironmentA: { value: null },
  uEnvironmentB: { value: null },
  uSkySun: { value: (50 * Math.PI) / 180 },
  uSkyMood: { value: 1 },
  uSolarColor: { value: new THREE.Vector3(1, 0.7, 0.3) },
};
installPrefilterUniforms(THREE, uniforms);
installRefractionUniforms(THREE, uniforms);
installPhotoSkyUniforms(uniforms);
let renderer,
  camera,
  scene,
  sea,
  skyMesh,
  seabed = null,
  refractionPass = null,
  spectral = null,
  capillary = null,
  atmosphere = null,
  initializingAtmosphere = false,
  initializingSpectral = false,
  renderingFoam = false,
  lastSpectralTime = 0,
  updateFoam = () => {},
  resizeFoam = () => {};
let targetYaw = 0,
  yaw = 0,
  targetPitch = -0.28,
  pitch = -0.28,
  height = 4.2,
  targetHeight = 4.2;
function fail(e) {
  console.error(e);
  $("loading").hidden = true;
  $("error").hidden = false;
}
function startCpuCapillary(time) {
  try {
    capillary = createCpuCapillaryOcean(THREE, renderer);
    capillary.update(time);
    capillary.validate();
    uniforms.uCapillary0.value = capillary.bands[0].output.texture;
    uniforms.uCapillary1.value = capillary.bands[1].output.texture;
    uniforms.uCapillaryReady.value = 2;
  } catch (error) {
    capillary?.dispose();
    capillary = null;
    uniforms.uCapillaryReady.value = 0;
    uniforms.uCapillary0.value = null;
    uniforms.uCapillary1.value = null;
    console.warn(
      "CPU short-wave spectrum unavailable; using analytic ripples",
      error,
    );
  }
}
function readState() {
  return {
    preset: current,
    wave: Number($("wave").value),
    wind: Number($("wind").value),
    light: Number($("light").value),
    paused,
  };
}
function updateInputs() {
  for (const id of ["wave", "wind", "light"]) {
    const el = $(id);
    $(id + "-out").value =
      id === "light" ? el.value + "°" : Number(el.value).toFixed(1);
    const pct = ((el.value - el.min) / (el.max - el.min)) * 100;
    el.style.setProperty("--progress", pct + "%");
    el.style.background = `linear-gradient(to right,#c3d3cd ${pct}%,#cadfd128 ${pct}%)`;
  }
}
function setPreset(name) {
  if (!Object.hasOwn(presets, name)) throw Error("Unknown preset");
  current = name;
  const p = presets[name];
  for (const k of ["wave", "wind", "light"]) $(k).value = p[k];
  document.querySelectorAll("[data-preset]").forEach((b) => {
    b.classList.toggle("active", b.dataset.preset === name);
    b.setAttribute("aria-pressed", b.dataset.preset === name);
  });
  updateInputs();
}
function setPause(value) {
  paused = value;
  $("pause").innerHTML = paused
    ? "▷ <span>再生</span>"
    : "Ⅱ <span>一時停止</span>";
  $("pause").setAttribute(
    "aria-label",
    paused ? "アニメーションを再生" : "アニメーションを一時停止",
  );
}
function toggleHUD() {
  hidden = !hidden;
  document.body.classList.toggle("hide-ui", hidden);
  document.querySelectorAll(".hud").forEach((el) => {
    el.inert = hidden;
    el.setAttribute("aria-hidden", String(hidden));
  });
  $("hide").setAttribute(
    "aria-label",
    hidden ? "操作パネルを表示" : "操作パネルを隠す",
  );
}
try {
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, pixelCap()));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  $("scene").appendChild(renderer.domElement);
  renderer.domElement.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    fail(new Error("WebGL context lost"));
  });
  renderer.domElement.addEventListener("webglcontextrestored", () =>
    location.reload(),
  );
  renderer.debug.onShaderError = (gl, program, vs, fs) => {
    const error = new Error(
      gl.getProgramInfoLog(program) +
        " " +
        gl.getShaderInfoLog(vs) +
        " " +
        gl.getShaderInfoLog(fs),
    );
    if (initializingSpectral || initializingAtmosphere || renderingFoam)
      throw error;
    fail(error);
  };
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 5000);
  function oceanGeometry() {
    const rings = quality === "high" ? 512 : quality === "light" ? 256 : 384,
      segments = quality === "high" ? 768 : quality === "light" ? 384 : 512;
    uniforms.uGridRadialStep.value = Math.log(9601) / rings;
    uniforms.uGridAngularStep.value = (2 * Math.PI) / segments;
    const vertices = [0, 0, 8],
      indices = [];
    for (let r = 1; r <= rings; r++) {
      const radius = 0.25 * (Math.exp((r / rings) * Math.log(9601)) - 1);
      for (let j = 0; j < segments; j++) {
        const a = (j / segments) * Math.PI * 2;
        vertices.push(Math.cos(a) * radius, 0, 8 + Math.sin(a) * radius);
      }
    }
    for (let j = 0; j < segments; j++)
      indices.push(0, 1 + ((j + 1) % segments), 1 + j);
    for (let r = 1; r < rings; r++)
      for (let j = 0; j < segments; j++) {
        const a = 1 + (r - 1) * segments + j,
          b = 1 + (r - 1) * segments + ((j + 1) % segments),
          c = 1 + r * segments + j,
          d = 1 + r * segments + ((j + 1) % segments);
        indices.push(a, b, c, b, d, c);
      }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(vertices, 3),
    );
    geometry.setIndex(indices);
    return geometry;
  }
  const geo = oceanGeometry();
  sea = new THREE.Mesh(
    geo,
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: vertex,
      fragmentShader: fragment,
      side: THREE.DoubleSide,
    }),
  );
  sea.frustumCulled = false;
  scene.add(sea);
  skyMesh = new THREE.Mesh(
    new THREE.SphereGeometry(3000, 32, 16),
    new THREE.ShaderMaterial({
      uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader:
        "varying vec3 vDir;void main(){vDir=position;gl_Position=projectionMatrix*viewMatrix*vec4(position+cameraPosition,1.);}",
      fragmentShader:
        shaderCommon +
        PHOTO_SKY_GLSL +
        "varying vec3 vDir;void main(){vec3 d=normalize(vDir);gl_FragColor=vec4(tonemap(uPhotoSkyReady>.5?photographicSky(d):sky(d,true)),1.);}",
    }),
  );
  skyMesh.renderOrder = -1;
  skyMesh.frustumCulled = false;
  scene.add(skyMesh);
  try {
    initializingSpectral = true;
    spectral = createSpectralOcean(THREE, renderer);
    if (spectral) {
      spectral.update(0, qualityProfiles[quality].rate);
      spectral.validate();
      const [a, b, c] = spectral.cascades;
      uniforms.uFieldLarge.value = a.output.textures[0];
      uniforms.uFieldSmall.value = b.output.textures[0];
      uniforms.uFieldFine.value = c.output.textures[0];
      uniforms.uNormalLarge.value = a.output.textures[1];
      uniforms.uNormalSmall.value = b.output.textures[1];
      uniforms.uNormalFine.value = c.output.textures[1];
      uniforms.uSpectral.value = 1;
    }
  } catch (error) {
    spectral?.dispose();
    spectral = null;
    uniforms.uSpectral.value = 0;
    for (const key of [
      "uFieldLarge",
      "uFieldSmall",
      "uFieldFine",
      "uNormalLarge",
      "uNormalSmall",
      "uNormalFine",
    ])
      uniforms[key].value = null;
    renderer.setRenderTarget(null);
    console.warn(
      "Spectral initialization unavailable; using Gerstner ocean",
      error,
    );
  } finally {
    initializingSpectral = false;
  }
  try {
    initializingSpectral = true;
    if (!spectral) capillary = createCapillaryOcean(THREE, renderer);
    if (capillary) {
      capillary.update(0, qualityProfiles[quality].rate);
      capillary.validate();
      uniforms.uCapillary0.value = capillary.bands[0].output.texture;
      uniforms.uCapillary1.value = capillary.bands[1].output.texture;
      uniforms.uCapillaryReady.value = 1;
    }
  } catch (error) {
    capillary?.dispose();
    capillary = null;
    uniforms.uCapillaryReady.value = 0;
    renderer.setRenderTarget(null);
    console.warn(
      "GPU short-wave spectrum unavailable; trying CPU spectrum",
      error,
    );
  } finally {
    initializingSpectral = false;
  }

  if (!spectral && !capillary) startCpuCapillary(0);
  const foamTargets = [];
  let foamMaterial = null,
    foamGeometry = null,
    foamRead = 0,
    foamAnchorInitialized = false;
  const foamPrevious = renderer.getRenderTarget(),
    foamPreviousFace = renderer.getActiveCubeFace(),
    foamPreviousLevel = renderer.getActiveMipmapLevel();
  const disableFoam = (error) => {
    updateFoam = () => {};
    resizeFoam = () => {};
    uniforms.uFoamReady.value = 0;
    uniforms.uFoamTex.value = null;
    for (const target of foamTargets) target.dispose();
    foamMaterial?.dispose();
    foamGeometry?.dispose();
    console.warn(
      "Foam history unavailable; retaining instantaneous whitecaps",
      error,
    );
  };
  let foamInitializationError = null;
  try {
    const foamType = renderer.extensions.has("EXT_color_buffer_float")
      ? THREE.HalfFloatType
      : THREE.UnsignedByteType;
    uniforms.uFoamScale.value = foamType === THREE.UnsignedByteType ? 2.1 : 1;
    for (let i = 0; i < 2; i++)
      foamTargets.push(
        new THREE.WebGLRenderTarget(512, 512, {
          type: foamType,
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          depthBuffer: false,
          stencilBuffer: false,
        }),
      );
    const foamUniforms = {
      ...uniforms,
      uPreviousFoam: { value: foamTargets[0].texture },
      uSimDt: { value: 0 },
      uFoamDelta: { value: new THREE.Vector2() },
      uFoamResolution: { value: 512 },
      uFoamQuantized: { value: foamType === THREE.UnsignedByteType ? 1 : 0 },
    };
    const foamScene = new THREE.Scene(),
      foamCamera = new THREE.Camera();
    foamMaterial = new THREE.ShaderMaterial({
      uniforms: foamUniforms,
      vertexShader:
        "varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}",
      fragmentShader: foamFragment,
      depthTest: false,
      depthWrite: false,
    });
    foamGeometry = new THREE.PlaneGeometry(2, 2);
    foamScene.add(new THREE.Mesh(foamGeometry, foamMaterial));
    const gl = renderer.getContext();
    for (const target of foamTargets) {
      renderer.setRenderTarget(target);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
        throw new Error("Foam framebuffer is incomplete");
      renderer.clear();
    }
    resizeFoam = (size) => {
      if (foamTargets[0].width === size) return;
      const previous = renderer.getRenderTarget(),
        face = renderer.getActiveCubeFace(),
        level = renderer.getActiveMipmapLevel(),
        next = [];
      let failure = null;
      try {
        for (let i = 0; i < 2; i++) {
          const target = new THREE.WebGLRenderTarget(size, size, {
            type: foamType,
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            depthBuffer: false,
            stencilBuffer: false,
          });
          next.push(target);
          renderer.setRenderTarget(target);
          if (
            gl.checkFramebufferStatus(gl.FRAMEBUFFER) !==
            gl.FRAMEBUFFER_COMPLETE
          )
            throw new Error("Foam resize framebuffer is incomplete");
          renderer.clear();
        }
        foamAnchorInitialized = false;
        for (const target of foamTargets) target.dispose();
        foamTargets.splice(0, 2, ...next);
        foamRead = 0;
        foamUniforms.uFoamResolution.value = size;
        uniforms.uFoamTex.value = next[0].texture;
        foamUniforms.uPreviousFoam.value = next[0].texture;
      } catch (error) {
        for (const target of next) target.dispose();
        failure = error;
      } finally {
        renderingFoam = false;
        renderer.setRenderTarget(previous, face, level);
      }
      if (failure) disableFoam(failure);
    };
    updateFoam = (dt) => {
      if (dt <= 0) return;
      const resolution = foamTargets[0].width,
        cell = 400 / resolution;
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      const distance = dir.y < -0.01 ? -camera.position.y / dir.y : 0;
      const anchorX =
        Math.round(
          (camera.position.x +
            Math.max(-152, Math.min(152, dir.x * distance))) /
            cell,
        ) * cell;
      const anchorZ =
        Math.round(
          (camera.position.z +
            Math.max(-152, Math.min(152, dir.z * distance))) /
            cell,
        ) * cell;
      const dx = anchorX - uniforms.uFoamAnchor.value.x,
        dz = anchorZ - uniforms.uFoamAnchor.value.y;
      if (paused && foamAnchorInitialized && dx === 0 && dz === 0) return;
      const previous = renderer.getRenderTarget(),
        face = renderer.getActiveCubeFace(),
        level = renderer.getActiveMipmapLevel();
      let failure = null;
      try {
        uniforms.uFoamAnchor.value.set(anchorX, anchorZ);
        if (
          !foamAnchorInitialized ||
          Math.abs(dx) > 200 ||
          Math.abs(dz) > 200
        ) {
          for (const target of foamTargets) {
            renderer.setRenderTarget(target);
            renderer.clear();
          }
          foamRead = 0;
          foamAnchorInitialized = true;
          uniforms.uFoamTex.value = foamTargets[0].texture;
          uniforms.uFoamReady.value = 1;
          return;
        }
        const write = 1 - foamRead;
        foamUniforms.uPreviousFoam.value = foamTargets[foamRead].texture;
        foamUniforms.uFoamDelta.value.set(dx, dz);
        foamUniforms.uSimDt.value = paused ? 0 : dt;
        renderer.setRenderTarget(foamTargets[write]);
        renderingFoam = true;
        renderer.render(foamScene, foamCamera);
        foamRead = write;
        uniforms.uFoamTex.value = foamTargets[foamRead].texture;
        uniforms.uFoamReady.value = 1;
      } catch (error) {
        failure = error;
      } finally {
        renderingFoam = false;
        renderer.setRenderTarget(previous, face, level);
      }
      if (failure) disableFoam(failure);
    };
  } catch (error) {
    foamInitializationError = error;
  } finally {
    renderer.setRenderTarget(foamPrevious, foamPreviousFace, foamPreviousLevel);
  }
  if (foamInitializationError) disableFoam(foamInitializationError);
  try {
    seabed = createSeabed(THREE, uniforms);
    scene.add(seabed.displayMesh);
    sea.renderOrder = 1;
    refractionPass = createRefractionPass(
      THREE,
      renderer,
      seabed.scene,
      uniforms,
    );
  } catch (error) {
    console.warn("Seabed initialization unavailable", error);
  }
  let atmosphereLoadSettled = false;
  if (renderer.extensions.has("EXT_color_buffer_float")) {
    const controller = new AbortController(),
      timeout = setTimeout(() => controller.abort(), 8000);
    fetch("./sky-radiance.bin", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Cloud asset unavailable");
        return response.arrayBuffer();
      })
      .then(async (buffer) => {
        try {
          await loadPhotoSky(THREE, uniforms, { signal: controller.signal });
        } catch (error) {
          console.warn(
            "Full-resolution sky unavailable; using HDR cube",
            error,
          );
        }
        try {
          initializingAtmosphere = true;
          atmosphere = createAtmosphere(
            THREE,
            renderer,
            uniforms,
            { sun: uniforms.uSun.value, mood: uniforms.uMood.value, time: 0 },
            new Uint8Array(buffer),
          );
        } finally {
          initializingAtmosphere = false;
        }
      })
      .catch((error) => {
        atmosphere = null;
        uniforms.uEnvironmentReady.value = 0;
        console.warn(
          "Atmosphere capture unavailable; using analytic sky",
          error,
        );
      })
      .finally(() => {
        clearTimeout(timeout);
        atmosphereLoadSettled = true;
      });
  } else {
    atmosphereLoadSettled = true;
  }
  let last = performance.now(),
    ready = false,
    needsRender = true;
  let patternSettled = false,
    patternTexture = null;
  const patternTimeout = setTimeout(() => {
    patternSettled = true;
    patternTexture?.dispose();
    needsRender = true;
  }, 8000);
  try {
    patternTexture = new THREE.TextureLoader().load(
      "./foam-pattern.png",
      (texture) => {
        if (patternSettled) {
          texture.dispose();
          return;
        }
        clearTimeout(patternTimeout);
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.colorSpace = THREE.NoColorSpace;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.needsUpdate = true;
        uniforms.uFoamPattern.value = texture;
        uniforms.uFoamPatternReady.value = 1;
        patternSettled = true;
        needsRender = true;
      },
      undefined,
      () => {
        clearTimeout(patternTimeout);
        patternTexture?.dispose();
        patternSettled = true;
        needsRender = true;
      },
    );
  } catch (error) {
    clearTimeout(patternTimeout);
    patternSettled = true;
    console.warn("Foam pattern unavailable; using procedural fallback", error);
  }
  const settle = (value, target, smooth) => {
    let next = value + (target - value) * smooth;
    if (Math.abs(target - next) < 1e-5) next = target;
    if (next !== value) needsRender = true;
    return next;
  };
  function draw(now) {
    requestAnimationFrame(draw);
    let dt = Math.min((now - last) / 1000, 0.04);
    last = now;
    if (document.hidden || !atmosphereLoadSettled || !patternSettled) return;
    if (!paused && dt > 0) {
      time += dt;
      needsRender = true;
    }
    uniforms.uTime.value = time;
    let smooth = 1 - Math.exp(-dt * 3);
    for (const [id, key, scale] of [
      ["wave", "uWave", 1],
      ["wind", "uWind", 1],
      ["light", "uSun", Math.PI / 180],
    ])
      uniforms[key].value = settle(
        uniforms[key].value,
        Number($(id).value) * scale,
        smooth,
      );
    uniforms.uMood.value = settle(
      uniforms.uMood.value,
      presets[current].mood,
      smooth,
    );
    yaw = settle(yaw, targetYaw, smooth);
    pitch = settle(pitch, targetPitch, smooth);
    height = settle(height, targetHeight, smooth);
    camera.position.set(
      0,
      Math.max(height, 3.2 * uniforms.uWave.value) +
        Math.sin(time * 0.22) * 0.08,
      8,
    );
    const horizontal = Math.cos(pitch) * 100;
    camera.lookAt(
      Math.sin(yaw) * horizontal,
      camera.position.y + Math.sin(pitch) * 100,
      8 - Math.cos(yaw) * horizontal,
    );
    if (spectral && (needsRender || !paused)) {
      try {
        spectral.update(
          time,
          qualityProfiles[quality].rate,
          uniforms.uWave.value *
            Math.pow((5 + 12.5 * uniforms.uWind.value) / 15, 0.33),
        );
        lastSpectralTime = time;
      } catch (error) {
        spectral.dispose();
        spectral = null;
        uniforms.uSpectral.value = 0;
        for (const key of [
          "uFieldLarge",
          "uFieldSmall",
          "uFieldFine",
          "uNormalLarge",
          "uNormalSmall",
          "uNormalFine",
        ])
          uniforms[key].value = null;
        uniforms.uFoamReady.value = 0;
        renderer.setRenderTarget(null);
        console.warn(
          "Spectral renderer failed; continuing with Gerstner fallback",
          error,
        );
        if (!capillary) startCpuCapillary(time);
      }
    }
    if (capillary && !paused) {
      try {
        capillary.update(time, qualityProfiles[quality].rate);
      } catch (error) {
        const wasCpu = capillary.isCpu;
        capillary.dispose();
        capillary = null;
        uniforms.uCapillaryReady.value = 0;
        uniforms.uCapillary0.value = null;
        uniforms.uCapillary1.value = null;
        renderer.setRenderTarget(null);
        console.warn(
          "Short-wave spectrum failed; continuing with fallback",
          error,
        );
        if (!wasCpu) startCpuCapillary(time);
      }
    }
    motion.advance(
      paused ? 0 : dt,
      uniforms.uWind.value,
      uniforms.uSpectral.value,
    );
    updateFoam(dt);
    if (atmosphere) {
      try {
        if (
          atmosphere.update(
            { sun: uniforms.uSun.value, mood: uniforms.uMood.value, time },
            dt,
            quality,
            paused,
          )
        )
          needsRender = true;
      } catch (error) {
        atmosphere.dispose();
        atmosphere = null;
        needsRender = true;
        uniforms.uEnvironmentReady.value = 0;
        uniforms.uEnvironmentA.value = null;
        uniforms.uEnvironmentB.value = null;
        console.warn("Atmosphere update failed; using analytic sky", error);
      }
    }
    if (!needsRender) return;
    {
      const e =
        uniforms.uEnvironmentReady.value > 0.5
          ? uniforms.uSkySun.value
          : uniforms.uSun.value;
      uniforms.uSunDirection.value.set(
        -0.79863551 * Math.cos(e),
        Math.sin(e),
        -0.60181502 * Math.cos(e),
      );
    }
    refractionPass?.render(camera);
    renderer.render(scene, camera);
    needsRender = false;
    if (!ready) {
      ready = true;
      $("loading").style.opacity = "0";
      setTimeout(() => ($("loading").hidden = true), 850);
    }
  }
  requestAnimationFrame(draw);
  const pointers = new Map(),
    cv = renderer.domElement;
  let pinchDistance = 0;
  const clampHeight = (value) => Math.max(3.5, Math.min(30, value));
  const span = () => {
    const [a, b] = [...pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  cv.addEventListener("pointerdown", (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    pinchDistance = span();
    cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener("pointermove", (e) => {
    const previous = pointers.get(e.pointerId);
    if (!previous) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      targetYaw -= (e.clientX - previous.x) * 0.0025;
      targetPitch = Math.max(
        -1.42,
        Math.min(0.24, targetPitch + (e.clientY - previous.y) * 0.002),
      );
    } else {
      const distance = span();
      if (distance > 8 && pinchDistance > 8)
        targetHeight = clampHeight((targetHeight * pinchDistance) / distance);
      pinchDistance = distance;
    }
  });
  const releasePointer = (e) => {
    pointers.delete(e.pointerId);
    pinchDistance = span();
  };
  for (const event of ["pointerup", "pointercancel", "lostpointercapture"])
    cv.addEventListener(event, releasePointer);
  cv.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      targetHeight = clampHeight(targetHeight + e.deltaY * 0.008);
    },
    { passive: false },
  );
  addEventListener("resize", () => {
    needsRender = true;
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(devicePixelRatio, pixelCap()));
    renderer.setSize(innerWidth, innerHeight);
  });
  $("quality").textContent = qualityProfiles[quality].label;
  $("quality").onclick = () => {
    needsRender = true;
    quality =
      quality === "balanced"
        ? "high"
        : quality === "high"
          ? "light"
          : "balanced";
    high = quality !== "light";
    resizeFoam(quality === "high" ? 1024 : quality === "light" ? 256 : 512);
    uniforms.uDetail.value = qualityProfiles[quality].detail;
    const oldGeometry = sea.geometry;
    sea.geometry = oceanGeometry();
    oldGeometry.dispose();
    renderer.setPixelRatio(Math.min(devicePixelRatio, pixelCap()));
    $("quality").textContent = qualityProfiles[quality].label;
    $("quality").title =
      "画質: " + qualityProfiles[quality].label + "（時間補間あり）";
  };
} catch (e) {
  fail(e);
}
for (const id of ["wave", "wind", "light"])
  $(id).addEventListener("input", updateInputs);
document
  .querySelectorAll("[data-preset]")
  .forEach((b) => (b.onclick = () => setPreset(b.dataset.preset)));
$("pause").onclick = () => setPause(!paused);
$("hide").onclick = toggleHUD;
$("reset").onclick = () => {
  setPreset(current);
  targetYaw = 0;
  targetPitch = -0.28;
  targetHeight = 4.2;
};
$("fullscreen").onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch (e) {
    $("fullscreen").title = "このブラウザでは全画面表示を利用できません";
  }
};
addEventListener("keydown", (e) => {
  if (e.target.matches("input,button,a")) return;
  if (e.code === "Space") {
    e.preventDefault();
    setPause(!paused);
  }
  if (e.key.toLowerCase() === "h") toggleHUD();
  if (e.key === "Escape" && hidden) toggleHUD();
});
setPreset(current);
setPause(paused);
updateInputs();
if (document.modelContext?.registerTool) {
  try {
    document.modelContext.registerTool({
      name: "configure_ocean",
      description: "Select an ocean scene and set animation playback.",
      inputSchema: {
        type: "object",
        properties: {
          preset: { type: "string", enum: Object.keys(presets) },
          paused: { type: "boolean" },
        },
        required: ["preset"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        if (
          !input ||
          !Object.hasOwn(presets, input.preset) ||
          (input.paused !== undefined && typeof input.paused !== "boolean")
        )
          throw Error("Invalid ocean settings");
        setPreset(input.preset);
        if (input.paused !== undefined) setPause(input.paused);
        return readState();
      },
    });
  } catch (e) {
    console.warn("Optional browser tools unavailable", e);
  }
}
