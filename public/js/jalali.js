/* jalali.js — Jalali (Shamsi/Persian) calendar conversion + Persian digit helpers
   Extracted from sadhana-page.js Phase 5 (Session 25).
   Pure functions — no DOM dependencies. Loaded before sadhana-page.js. */

/* ══ JALALI CONVERSION ═════════════════════════ */
function g2j(gy,gm,gd){
  /* Exact port of calendar_utils.py g2j — must subtract 1600 first */
  gy-=1600;gm-=1;gd-=1;
  var g=365*gy+~~((gy+3)/4)-~~((gy+99)/100)+~~((gy+399)/400);
  var gdays=[31,28,31,30,31,30,31,31,30,31,30,31];
  for(var i=0;i<gm;i++)g+=gdays[i];
  if(gm>1&&((gy%4===0&&gy%100!==0)||gy%400===0))g++;
  g+=gd;
  var j=g-79;
  var cycles=~~(j/12053);j%=12053;
  var jy=979+33*cycles+4*~~(j/1461);
  j%=1461;
  if(j>=366){jy+=~~((j-1)/365);j=(j-1)%365;}
  var jm_days=[31,31,31,31,31,31,30,30,30,30,30,29];
  var jm=0;
  while(jm<11&&j>=jm_days[jm]){j-=jm_days[jm];jm++;}
  return[jy,jm+1,j+1];
}
function j2g(jy,jm,jd){
  var jy2=jy-979,jm2=jm-1,jd2=jd-1;
  var j_day_no=365*jy2+~~(jy2/33)*8+~~((jy2%33+3)/4);
  var jm_days=[31,31,31,31,31,31,30,30,30,30,30,29];
  for(var i=0;i<jm2;i++)j_day_no+=jm_days[i];
  j_day_no+=jd2;
  var g_day_no=j_day_no+79;
  var gy=1600+400*~~(g_day_no/146097);g_day_no%=146097;
  var leap=true;
  if(g_day_no>=36525){g_day_no--;gy+=100*~~(g_day_no/36524);g_day_no%=36524;if(g_day_no>=365)g_day_no++;else leap=false;}
  gy+=4*~~(g_day_no/1461);g_day_no%=1461;
  if(g_day_no>=366){leap=false;g_day_no--;gy+=~~(g_day_no/365);g_day_no%=365;}
  var gm_days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  var gm=0;
  for(;gm<12&&g_day_no>=gm_days[gm];gm++)g_day_no-=gm_days[gm];
  return[gy,gm+1,g_day_no+1];
}
function jalaliLeap(jy){return[1,5,9,13,17,22,26,30].includes(jy%33);}
/* Esfand: 30 days on leap years, 29 on others — all other months fixed */
function jMonthDays2(jy,jm){
  if(jm<=6)return 31;
  if(jm<=11)return 30;
  return jalaliLeap(jy)?30:29;
}
function nowJalali(){
  var n=new Date();
  return g2j(n.getFullYear(),n.getMonth()+1,n.getDate());
}
function jalaliWeekNum(jy,jm,jd){
  /* day of year */
  var jm_days=[31,31,31,31,31,31,30,30,30,30,30,29];
  var doy=0;
  for(var i=0;i<jm-1;i++)doy+=jm_days[i];
  doy+=jd;
  return Math.ceil(doy/7);
}
/* Shamsi month names */
const J_MONTHS=['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];
const J_MONTHS_EN=['Farvardin','Ordibehesht','Khordad','Tir','Mordad','Shahrivar','Mehr','Aban','Azar','Dey','Bahman','Esfand'];
const J_DAYS_FA=['ش','ی','د','س','چ','پ','ج'];/* شنبه to جمعه */

/* Full weekday names — JS getDay() order: 0=Sun … 6=Sat */
const WEEKDAY_FA=['یکشنبه','دوشنبه','سه‌شنبه','چهارشنبه','پنجشنبه','جمعه','شنبه'];
const WEEKDAY_EN=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];


function toFa(n){return String(n).replace(/\d/g,d=>'۰۱۲۳۴۵۶۷۸۹'[d]);}
// Expose to global namespace for sadhana-page.js
window.__hibJalali = { g2j, j2g, jalaliLeap, jMonthDays2, nowJalali, jalaliWeekNum, J_MONTHS, J_MONTHS_EN, J_DAYS_FA, WEEKDAY_FA, WEEKDAY_EN, toFa }
