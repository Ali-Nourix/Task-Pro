// A copy of the plugin's Gregorian <-> Jalali conversion (src/date-utils.ts), so
// the Edge Functions need nothing from outside this folder. A test compares the
// two over a hundred and fifty years.

/**
 * Convert Gregorian date to Jalali (Persian) date
 */
export function gregorianToJalali(gYear: number, gMonth: number, gDay: number): [number, number, number] {
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  
  let jy = (gYear <= 1600) ? 0 : 979;
  gYear -= (gYear <= 1600) ? 621 : 1600;
  
  let gy2 = (gMonth > 2) ? (gYear + 1) : gYear;
  let days = (365 * gYear) + (Math.floor((gy2 + 3) / 4)) - (Math.floor((gy2 + 99) / 100)) + 
             (Math.floor((gy2 + 399) / 400)) - 80 + gDay + g_d_m[gMonth - 1];
  
  jy += 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  
  const jm = (days < 186) ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + ((days < 186) ? (days % 31) : ((days - 186) % 30));
  
  return [jy, jm, jd];
}

/**
 * Convert Jalali (Persian) date to Gregorian date
 */
export function jalaliToGregorian(jYear: number, jMonth: number, jDay: number): [number, number, number] {
  let gy = (jYear <= 979) ? 621 : 1600;
  jYear -= (jYear <= 979) ? 0 : 979;
  
  let days = (365 * jYear) + ((Math.floor(jYear / 33)) * 8) + (Math.floor(((jYear % 33) + 3) / 4)) + 
             78 + jDay + ((jMonth < 7) ? (jMonth - 1) * 31 : ((jMonth - 7) * 30) + 186);
  
  gy += 400 * Math.floor(days / 146097);
  days %= 146097;
  
  let leap = true;
  if (days >= 36525) {
    days--;
    gy += 100 * Math.floor(days / 36524);
    days %= 36524;
    if (days >= 365) days++;
    else leap = false;
  }
  
  gy += 4 * Math.floor(days / 1461);
  days %= 1461;
  
  if (days >= 366) {
    leap = false;
    days--;
    gy += Math.floor(days / 365);
    days %= 365;
  }
  
  const sal_a = [0, 31, ((leap ? 29 : 28)), 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 0;
  for (gm = 0; gm < 13 && days >= sal_a[gm]; gm++) {
    days -= sal_a[gm];
  }
  const gd = days + 1;
  
  return [gy, gm, gd];
}
